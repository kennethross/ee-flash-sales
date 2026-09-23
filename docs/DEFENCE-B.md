# Defence notes — Inventory Reservation System

Draft answers for the technical rounds, written from the code. Rewrite each in your own words
before the interview; the last two are yours alone.

**1. Walk me through what happens when 500 users click Buy on the last item.**
Each request reaches `InventoryService.reserve`, which validates the input synchronously and then
asks `KeyedMutex` for the lock on that product's SKU. The first caller gets it at once; the other
499 are chained behind it as promises, in arrival order. Inside the lock the first caller loads the
product and its reservations, computes `available = 1`, saves an Active reservation and returns.
The second caller then runs the same load, sees `available = 0`, and returns `OUT_OF_STOCK`
without writing; so do the remaining 498. The test `R9 — stock 1, 500 simultaneous reserves` asserts
exactly 1 success and 499 failures and that `available` ends at 0.

**2. Why does an in-memory Map need a lock in single-threaded Node?**
It doesn't, if the read and the write are in the same synchronous run: nothing can interrupt them.
It does as soon as there is an `await` between them, because `await` hands control back to the
event loop and every other pending request gets to run. My store's methods return promises (the port
is asynchronous because that is where a database goes), so `reserve` awaits between reading stock
and writing the reservation. I verified this before writing any code: a Map behind `async` methods
with no lock sold 500 of 1. The lock is what makes the check and the write one unit again.

**3. Show me the test that proves the lock is doing something.**
`tests/application/inventory-service.concurrency.test.ts`, second test: the same 500 requests with
`NoLock` instead of `KeyedMutex`, asserting *more than one* success and negative availability. It
exists so the first test can be shown to be meaningful. I also did a mutation check during the
build: replaced `KeyedMutex.withLock` with `return task()` and watched the 500-request test and the
mixed-load test fail, then restored it.

**4. What does your mutex guarantee, and what does it not?**
It guarantees that tasks submitted for the same key run one at a time, in submission order, and that
a task that throws neither blocks the next one nor hides its error from its caller. It does not
guarantee anything across processes, it does not time out (a task that never settles blocks its key
for ever), and it does not protect reads, which deliberately bypass it.

**5. Why one lock per SKU rather than one global lock?**
A global lock would make buyers of product B wait behind buyers of product A for no reason;
availability of one product has nothing to do with another. `KeyedMutex` creates a `Mutex` per SKU
on first use, so contention is scoped to the thing actually contended. The test `lets tasks with
different keys overlap` shows a task on `sku-2` finishing while `sku-1` is still held.

**6. Can this deadlock? Why not?**
No. An operation holds at most one lock and never asks for a second while holding it; confirm and
cancel find the SKU first, outside any lock, and then take that one lock. Deadlock needs two parties
each waiting for the other's lock, which cannot arise with one lock per operation.

**7. What happens if the task inside the lock throws?**
`runExclusive` returns `this.#tail.then(task)` to the caller, so the caller sees the rejection. The
queue itself is advanced with `result.then(noop, noop)`, a promise that settles either way, so the
next task still runs. The test `a task that throws neither blocks the next task nor swallows its
error` covers both halves. In practice domain outcomes are `Result` values, so a throw inside the
lock means a bug, which the HTTP layer turns into a JSON 500 and reports.

**8. Why is expiry not a timer? What is the trade-off?**
A `setTimeout` per reservation is lost on restart, is hard to test without waiting or faking timers,
and grows with the number of reservations. Instead the reservation stores `expiresAt`, and
`available()` only counts it while `expiresAt > now`, so stock returns at the exact instant with no
background work. The trade-off is that the stored state label lags: an overdue reservation is
recorded as `Expired` the next time its product is written, and `snapshot()` reports the effective
state without writing. A sweeper would close that gap and is on the improvements list.

**9. A reservation expires at 120 000 ms exactly — why that side of the boundary?**
The brief says "hold for 2 minutes" without saying which side the boundary falls on. I chose
`expiresAt <= now` means expired, so stock is never held a moment longer than promised. The tests pin
it to the millisecond: confirm at t+119 999 ms succeeds, at t+120 000 ms it fails as Expired.

**10. What happens when two instances of this service run behind a load balancer?**
Each has its own `Map` of mutexes and its own `Map` of stock, so they cannot see each other at all;
with a shared store they would each serialise their own requests and still oversell between
instances. I ran that scenario with four Node processes and a shared file before writing any code:
four sold of one. The mutex is correct for one process, which is the brief's scope ("inventory in
memory"), and the README says where it stops.

**11. How would you make it correct across instances? Compare two options.**
Move the decision into the shared store. Option one: a conditional write, `UPDATE products SET
reserved = reserved + $q WHERE sku = $s AND total - sold - reserved >= $q`; one row changed means you
got it, zero means sold out, and the database's row lock does the queueing. Option two: one writer
per SKU, routing every command for a product to a single consumer through a partitioned queue, which
is this design's mutex stretched across machines. The first is simpler and my default; the second
scales further and gives an audit log. A distributed lock like Redlock is the literal translation
but needs fencing tokens to be safe, so I would not start there.

**12. Why is confirm reloading the reservation inside the lock?**
The first lookup, outside the lock, only tells me which product's lock to take. By the time I hold
it, another caller may have confirmed, cancelled or expired that reservation, so I reload and decide
on fresh state. Deciding on the stale copy would be a time-of-check-to-time-of-use bug.

**13. Why `Result` values instead of exceptions?**
"Out of stock" and "already confirmed" are expected outcomes, not failures of the program, and the
caller must handle them. A `Result` forces that at the type level: you cannot touch `value` without
checking `ok`. It also gives one place, the code→status table in `app.ts`, to map every failure to
an HTTP status. Exceptions are kept for bugs, which the `onError` handler turns into a 500.

**14. Where does `unknown` become typed, and why there?**
In `src/http/guards.ts`. Request bodies are read as `unknown` and narrowed by hand-written checks
for shape and JSON type; the service then applies the business rules on typed input. The boundary
is the only place external data enters, so it is the only place an assertion is needed, and it is
one line: an `object` that is not null and not an array is a JSON object. ESLint's `no-unsafe-*`
rules are on, so an `any` cannot leak past it.

**15. Why Hono, and why is the app separated from the server?**
Hono is small, TypeScript-first, and `app.request()` runs a route in-process without a socket, so
the whole API including the 500-request sale is tested without listening on a port. `createApp`
builds routes only; `startServer` wires infrastructure, seeds the demo product, adds static files and
listens. That split is why the route tests are fast and the server test is one file.

**16. What would you add for production, in priority order?**
Persistence behind the same `InventoryStore` interface; the reservation decision in the store so
several instances can run; idempotency keys on `reserve`; an expiry sweeper; backpressure (fail fast
when sold out, cap the queue); ownership checks on confirm and cancel; request ids, structured logs
and metrics; a body limit, health endpoint and rate limiting.

**17. What did the AI get wrong, and how did you catch it?**
It first recommended Go for the concurrency story; I rejected that because I would be defending an
unfamiliar language live. It named Redis and Postgres in the architecture, which I read as scope
creep and cut back to the simplest thing that works. During the build its own commit-message hook
rejected one of its commits for a subject over 72 characters, and its predicted test counts in the
plan were wrong until it ran the code. All of it is in `docs/working/JOURNAL.md`.

**18. Which decisions were yours?**
Building B alongside A and choosing afterwards; TypeScript with an async mutex; library plus HTTP
API; Hono; the simulator page from my sketch and its static implementation; the "simplest thing that
works" goal; enforcing conventional commits with hooks; no `any`; and every section of the design
as it was presented to me.

**19. If stock were 1 000 and requests 100 000, what breaks first?**
Memory and latency, not correctness. Every request joins the SKU's promise chain, so the last of
100 000 waits for 99 999 locked sections; each is microseconds in memory but would be milliseconds
against a database, so tail latency grows linearly. The fix is backpressure: once `available` is 0,
answer `OUT_OF_STOCK` before joining the queue (a read outside the lock, then a checked write
inside), and cap the queue length. Correctness holds throughout because the decision is always made
inside the lock.

**20. How would you add idempotency to `reserve`?**
Accept an `Idempotency-Key` header, keep a map from key to the first result per user, and inside
the SKU lock check it before deciding, so a retried request returns the same reservation instead of
holding a second one. The map lives next to the reservations in the store so it survives with them.

**21. How does the audit trail stay consistent with the locking?**
Each line is written by the service inside the same lock as the decision it records, right after
the save, so the log order is the real order and a rejected attempt is recorded next to the reserve
that beat it. It is an append to the store, not a separate system, so it cannot drift from the
data. Expiry is logged when the system notices it, which is the next write to that product, and
the log says so rather than pretending to a timer it does not have. The in-memory store keeps the
latest 200 lines; in production this would be an append-only table or an event stream, which is
also the natural place for the "one writer per SKU" design.

**22. How does the waiting list hand an item to the next person without a timer per person?**
Nothing is scheduled per person. Every waiting-list decision is one function, `#promote`, that
runs inside the product's lock: it first settles each offered entry by what became of its hold
(confirmed → Bought, cancelled or expired → Passed), then, if the product is released, offers
ordinary holds to the first `Waiting` entries while stock is free. It runs after every write to
that product, which is why a cancel passes the item on immediately, and from one server-wide
sweeper every second, which is what notices a release time or an expired hold when nobody is
clicking. It is idempotent, so running it twice offers nothing twice, and a sweep racing a user's
click just queues on the same lock.

**23. Why can't someone buy directly once the product is released?**
Because the line would be meaningless at the exact moment it matters. `reserve` checks two things
after loading the product under the lock: not yet released → `NOT_RELEASED`; anyone still
`Waiting` → `WAITLIST_ACTIVE` with the number ahead. Once the line is empty, ordinary sales resume.
Joining after release with free stock is offered at once, so joining is never worse than buying.

**24. What edge cases did you handle in the waiting list, and which did you leave?**
Handled and tested: more people than stock; a hold not confirmed in time (passes on within a
second); cancel (passes on at once); joining twice (`ALREADY_QUEUED`); leaving while waiting or
while holding an offer (the hold is cancelled and passes on); a release time already in the past;
a release time brought forward or postponed after offers were made (offers stay); stock added
later; deleting the product or resetting; hold time changed between offers; the boundary at
`releaseAt` exactly; 500 concurrent joins. Left, on purpose: quantities per place (one unit each);
priorities or VIP lanes; notifying the person that their turn came (the page polls); persistence
across restarts, as everywhere else in this build.

**25. Walk me through the Dockerfile. Why four stages?**
`deps` installs everything once so the later stages share the layer. `build` type-checks, compiles
the page with `tsc` and bundles the server with esbuild into one `dist/main.js`; esbuild rather
than `tsc` emit because the source uses extensionless ESM imports, which Node's loader rejects at
runtime, and esbuild is the compiler `tsx` already uses in development. `test` runs Prettier,
ESLint and the whole suite and writes a marker file. `runtime` starts again from `node:22-alpine`,
installs production dependencies only (`--omit=dev --ignore-scripts`, because the `prepare` hook
installs husky, a dev tool that needs git), copies `dist/` and `public/` from `build` and the
marker from `test`, so the final image cannot be produced if the tests failed. It runs as the
non-root `node` user, declares a `HEALTHCHECK` on `/api/health`, and since Node is PID 1 the
SIGTERM handler in `main.ts` makes `docker stop` graceful (225 ms in practice). The app's layers
are under 7 MB; the base is the rest. State is in the process, so one replica.

**26. (yours)** What would you do differently if you started again?

**27. (yours)** Which part of this code are you least sure about, and why?
