# Inventory Reservation System

A reservation service for flash sales that does not oversell, with an HTTP API and a simulator page.
Submitted for the Everest Engineering coding challenge (Challenge B).

- **Stack:** TypeScript (strict), Node ≥ 22.13, Hono, Vitest. Two runtime dependencies (`hono`,
  `@hono/node-server`).
- **Tests:** 184 tests in 16 files, including four concurrency tests; coverage 96.5% lines,
  91.4% branches, 97.4% functions on `src/` (page excluded). The Docker build runs them all
  before an image can exist.
- **Locking:** one promise-chain mutex per product around every write. See
  [Locking strategy](#locking-strategy).

## Quick start

```bash
npm ci
npm test
npm start          # builds the page and serves http://localhost:3000 (PORT to change)
npm run start:prod # same, from the esbuild bundle in dist/ (what the container runs)
```

`npm start` seeds one product, **Flash Sale Ticket** with stock 1. Open the page, click **Everyone
adds to cart**, and watch one customer get it and the rest get `Only 0 of flash-ticket available; 1
requested.`, with every attempt in the **Activity** list. A cart is the customer's active holds:
**Checkout** confirms them, **Remove** cancels one, and a hold expires on its own (set the hold time
to 10 seconds to watch that happen). **Reset inventory** puts everything back to the seed.

## Run in Docker

```bash
docker compose up            # builds the image, serves http://localhost:3000, health-checked
HOST_PORT=8080 docker compose up
docker build -t inventory-reservation . && docker run --rm -p 3000:3000 inventory-reservation
```

The `Dockerfile` has four stages: **deps** (`npm ci`), **build** (type-check, compile the page
with `tsc`, bundle the server with esbuild into `dist/main.js`), **test** (Prettier, ESLint and the
whole suite, leaving a marker file), and **runtime** (`node:22-alpine`, production dependencies
only, the compiled output, and the marker copied from the test stage, so an image cannot be
produced unless the tests passed). The runtime stage runs as the non-root `node` user, declares a
`HEALTHCHECK` on `GET /api/health`, and handles SIGTERM itself so `docker stop` is graceful. The
app's own layers are under 7 MB; the rest of the ~240 MB image is the Node base.

State lives in the process, so run one replica; `compose.yaml` says so.

## What it does

- Products with stock; reservations of one or more units.
- Reservation lifecycle `Active → Confirmed | Cancelled | Expired`, hold time 2 minutes by default.
- `available = total − confirmed − active`; a reserve that would exceed it fails.
- Confirmed purchases cannot be reversed; cancel and expiry release stock at once.
- Under 500 simultaneous requests for one item, exactly one succeeds.
- An audit trail of every action, including the rejected ones, and a reset to the seed state.
- **Coming-soon products with a waiting list:** a product can carry a release time; people join a
  first-come-first-served line before it; at release the first in line automatically get a hold
  for the hold time, and a hold that expires or is cancelled passes to the next person. While
  anyone is waiting, the queue goes first.

## API

JSON under `/api`. Failures are `{ "error": { "code", "message" } }` with `VALIDATION` 400,
`NOT_FOUND` 404, `OUT_OF_STOCK` / `INVALID_STATE` / `ALREADY_EXISTS` / `NOT_RELEASED` /
`WAITLIST_ACTIVE` / `ALREADY_QUEUED` 409, and `INTERNAL` 500 for anything unexpected (reported
server-side, nothing leaked).

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/products` | `{ sku, name, totalStock, releaseAt? }` | 201 product view |
| PATCH | `/api/products/:sku` | `{ totalStock?, releaseAt? }` (`null` clears) | 200 product view |
| DELETE | `/api/products/:sku` | | 204 |
| POST | `/api/products/:sku/reservations` | `{ userId, quantity? }` | 201 reservation |
| POST | `/api/products/:sku/waitlist` | `{ userId }` | 201 entry with `position` |
| DELETE | `/api/waitlist/:id` | | 204 (an offered hold is cancelled and passes on) |
| POST | `/api/reservations/:id/confirm` | | 200 reservation |
| POST | `/api/reservations/:id/cancel` | | 200 reservation |
| PUT | `/api/settings/hold-time` | `{ holdTimeMs }` | 200 `{ holdTimeMs }` |
| GET | `/api/state` | | 200 products, reservations, events, waitlist, hold time |
| POST | `/api/reset` | | 200 the state after re-seeding |
| GET | `/api/health` | | 200 `{ status: "ok" }` |

A product view carries `confirmed`, `active`, `available`, `released` and `waiting` alongside
`totalStock`. Dates are ISO strings. `events` is the audit trail, oldest first, as
`{ seq, at, type, actor, message }`; the server keeps the latest 200. `waitlist` lists every
entry in join order with its `position` while it is `Waiting`.

## Waiting lists

A product with `releaseAt` in the future is *coming soon*: nobody can reserve it (`NOT_RELEASED`),
anyone can join its waiting list. The rule that does the work is **promote**, which runs inside the
product's lock after every write to that product and from a one-second server sweeper:

1. Settle every offered entry by what became of its hold: confirmed → `Bought`; cancelled or
   expired → `Passed`.
2. If the product is released, give each `Waiting` entry, in order, an ordinary Active reservation
   for the current hold time while stock is free, and mark it `Offered`.

So at the release instant the first in line get holds with nobody clicking, a missed hold passes to
the next person within a second, and a cancelled one passes at once. While anyone is `Waiting`, a
direct reservation is refused (`WAITLIST_ACTIVE`); ordinary sales resume when the line is empty.
One unit per place, one place per person. Design record: `docs/adr/0004-…`.

```bash
curl -X POST localhost:3000/api/products/flash-ticket/reservations \
  -H 'content-type: application/json' -d '{"userId":"ana"}'
# {"id":"…","sku":"flash-ticket","userId":"ana","quantity":1,"state":"Active","createdAt":"…","expiresAt":"…"}
```

## Design

```
src/domain          pure: Product + stock arithmetic, Reservation + its state machine, Result
src/application     InventoryService (the only place a lock is taken) and the ports it needs
src/infrastructure  InMemoryStore, the Mutex, SystemClock
src/http            guards (unknown → typed), routes, server
src/web             the simulator page's browser code
```

Imports point downward only. Domain functions take `now` as an argument and return `Result` values
(`{ ok: true, value }` or `{ ok: false, failure: { code, message } }`) instead of throwing;
exceptions are reserved for bugs.

Every write in the service has the same shape:

```ts
return this.#locks.withLock(sku, async () => {
  const loaded = await this.#load(sku, now); // read
  // ... pure domain decision ...
  await this.#store.saveReservation(reservation); // write
  await this.#record('reserved', userId, `reserved ${units(reservation)} …`); // audit
  return ok(reservation);
});
```

The audit line is written inside the lock, after the save, so the trail is in the order things
happened. Rejections are recorded too: the 499 losers of a flash sale are in the log.

## Locking strategy

**The problem.** Reserving is read-then-write: load the stock, decide, save. Node runs JavaScript on
one thread, so a *synchronous* read-then-write cannot be interrupted. But storage is asynchronous
(`await store.get(...)`), and every `await` lets other requests run. Without a lock, 500 concurrent
requests all read "1 available" before any of them writes, and all 500 succeed. The test
`WITHOUT the lock the same load oversells` shows exactly that, and the 500-request test was seen to
fail when the lock was removed.

**The lock.** `Mutex` is a promise chain of about ten lines: each task starts only when the previous
one has settled, so tasks run one at a time in arrival order. Nothing blocks a thread; waiting is a
promise that has not resolved yet. `KeyedMutex` keeps one `Mutex` per SKU, so buyers of one product
never wait behind buyers of another.

```ts
runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = this.#tail.then(task); // start after whoever is last in line
  this.#tail = result.then(noop, noop); // now I am last; a failure must not block the line
  return result; // the caller still gets their own outcome, including the failure
}
```

**What is inside the lock.** Load → decide → save, and nothing else. Confirm and cancel look their
reservation up first to learn which SKU's lock to take, then reload inside the lock, because the
reservation may have changed while they waited.

**Properties.**

- Fair: first come, first served, by construction.
- Deadlock-free: an operation holds one lock and never takes a second.
- Failure-safe: a task that throws does not block the queue; the caller still gets the error.
- Reads do not lock: `snapshot()` is one store call.

**Where it stops.** The mutex lives in one process. Two instances behind a load balancer have two
separate queues and can oversell between them. Beyond one process the decision has to move into the
shared store: a conditional `UPDATE … WHERE available >= quantity`, `SELECT … FOR UPDATE`, an atomic
Redis operation, or one writer per SKU through a partitioned queue. See
[Improvements](#improvements-with-more-time).

## Expiry

No timers. A reservation carries `expiresAt`; `available()` counts it only while `expiresAt > now`,
so stock returns the instant the hold ends. Whenever a product's reservations are loaded inside a
lock, overdue ones are recorded as `Expired`; `GET /api/state` shows the effective state before
that happens. A reservation is expired at `expiresAt` exactly.

## Assumptions

1. Several products, each with its own stock and lock.
2. A reservation is for `quantity ≥ 1` units (default 1).
3. Expired at `expiresAt` exactly.
4. No authentication: confirm and cancel take a reservation id and do not check the caller.
5. Hold time is one setting per running service; existing reservations keep their `expiresAt`.
6. Lowering total stock below `confirmed + active` is rejected, not clamped.
7. Deleting a product deletes its reservations (for the simulator).
8. Dates on the wire are ISO strings.

## Testing

Written test-first. Each `describe` that covers a requirement is named by its ID from the design
spec (`R1` … `R11`), so the brief's rules can be traced to the tests that hold them.

- **Domain:** the availability arithmetic and every state transition, including the exact expiry
  boundary (t+119 999 ms holds, t+120 000 ms expires), with a fake clock.
- **Service:** the lifecycle, validation, lazy expiry persistence, the audit trail (order, actors,
  the 200-event cap), reset, and the waiting list (release boundary, offers in order up to stock,
  pass-on after expiry or cancel, leaving, queue-first fairness, release-time edits).
- **Concurrency:** 500 simultaneous reserves sell exactly one; the same load without the lock
  oversells; a mixed load of reserve/confirm/cancel on two products never breaks
  `confirmed + active ≤ total`; 500 simultaneous joins get 500 distinct positions in arrival order.
- **HTTP:** every route through Hono's in-process `app.request()`, the 500-request sale over HTTP,
  a smoke test that starts the real server (including one that waits for the sweeper to release a
  product 1 s away), and one that spawns `npm start`'s entry point and stops it with SIGTERM.
- **Page:** type-checked, exercised by hand (checklist in the design record); not browser-tested.

```bash
npm test               # 184 tests
npm run test:coverage
npm run lint && npm run typecheck && npm run format:check
```

Commits pass a `pre-commit` hook running all of the above, and a `commit-msg` hook enforcing
conventional subjects.

## Improvements with more time

1. **Persistence.** `InMemoryStore` is a `Map`; swap in a database behind the same interface.
2. **More than one instance.** Move the decision into the store (conditional update, row lock,
   atomic Redis op, or one writer per SKU). A distributed lock is the literal translation but needs
   fencing tokens; an atomic store write is safer.
3. **Idempotency keys** so a retried `reserve` does not hold twice.
4. **Expiry timeliness.** The one-second waiting-list sweeper now records expiry for every product
   within a second; without it, expiry is recorded on the next write.
5. **Backpressure:** fail fast once sold out instead of joining the queue; cap queue length.
6. **Ownership** on confirm and cancel.
7. **Observability:** request ids, structured logs, metrics for rejections and lock wait time.
8. **Operations:** request body limit and rate limiting (a health endpoint and a container image
   exist).
9. **Error handling, one step further.** `app.onError`, `app.notFound` and the code→status table
   already centralise it; the next step is routes that throw typed errors mapped in one place,
   request ids on every error body, and structured logging of the reported ones.

## AI disclosure

- **Tool:** Claude Code (Anthropic), model Claude Fable 5.1.
- **How:** I chose the challenge, language, and design through a recorded conversation; the AI
  proposed the architecture, the per-SKU promise mutex, and expiry-on-read, and I approved each
  section. All code, tests and the first draft of this README were generated by the AI under my
  direction, test-first, in the commits you see.
- **What I checked:** the locking claims were demonstrated to me with runnable scripts before any
  code (with and without the lock; one process and four). I reviewed and approved the assumptions
  above and can walk through any file.
- **Where the AI was corrected:** it first recommended Go, which I rejected because I would be
  defending an unfamiliar language; it named Redis and Postgres in a design that I cut back to the
  simplest thing that works.
- The full decision log is in `docs/working/JOURNAL.md`.
