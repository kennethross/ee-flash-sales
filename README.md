# Inventory Reservation System

A reservation service for flash sales that does not oversell, with an HTTP API and a simulator page.
Submitted for the Everest Engineering coding challenge (Challenge B).

- **Stack:** TypeScript (strict), Node ≥ 22.13, Hono, Vitest. Two runtime dependencies (`hono`,
  `@hono/node-server`).
- **Tests:** 129 tests in 14 files, including three concurrency tests; coverage 96.9% lines,
  93.8% branches, 98.8% functions on `src/` (page excluded).
- **Locking:** one promise-chain mutex per product around every write. See
  [Locking strategy](#locking-strategy).

## Quick start

```bash
npm ci
npm test
npm start          # builds the page and serves http://localhost:3000 (PORT to change)
```

`npm start` seeds one product, **Flash Sale Ticket** with stock 1. Open the page, click **Everyone
adds to cart**, and watch one customer get it and the rest get `Only 0 of flash-ticket available; 1
requested.`, with every attempt in the **Activity** list. A cart is the customer's active holds:
**Checkout** confirms them, **Remove** cancels one, and a hold expires on its own (set the hold time
to 10 seconds to watch that happen). **Reset inventory** puts everything back to the seed.

## What it does

- Products with stock; reservations of one or more units.
- Reservation lifecycle `Active → Confirmed | Cancelled | Expired`, hold time 2 minutes by default.
- `available = total − confirmed − active`; a reserve that would exceed it fails.
- Confirmed purchases cannot be reversed; cancel and expiry release stock at once.
- Under 500 simultaneous requests for one item, exactly one succeeds.
- An audit trail of every action, including the rejected ones, and a reset to the seed state.

## API

JSON under `/api`. Failures are `{ "error": { "code", "message" } }` with `VALIDATION` 400,
`NOT_FOUND` 404, `OUT_OF_STOCK` / `INVALID_STATE` / `ALREADY_EXISTS` 409, and `INTERNAL` 500 for
anything unexpected (reported server-side, nothing leaked).

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/products` | `{ sku, name, totalStock }` | 201 product view |
| PATCH | `/api/products/:sku` | `{ totalStock }` | 200 product view |
| DELETE | `/api/products/:sku` | | 204 |
| POST | `/api/products/:sku/reservations` | `{ userId, quantity? }` | 201 reservation |
| POST | `/api/reservations/:id/confirm` | | 200 reservation |
| POST | `/api/reservations/:id/cancel` | | 200 reservation |
| PUT | `/api/settings/hold-time` | `{ holdTimeMs }` | 200 `{ holdTimeMs }` |
| GET | `/api/state` | | 200 products, reservations, events, hold time |
| POST | `/api/reset` | | 200 the state after re-seeding |

A product view carries `confirmed`, `active` and `available` alongside `totalStock`. Dates are ISO
strings. `events` is the audit trail, oldest first, as `{ seq, at, type, actor, message }`; the
server keeps the latest 200.

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
  the 200-event cap) and reset.
- **Concurrency:** 500 simultaneous reserves sell exactly one; the same load without the lock
  oversells; a mixed load of reserve/confirm/cancel on two products never breaks
  `confirmed + active ≤ total`.
- **HTTP:** every route through Hono's in-process `app.request()`, the 500-request sale over HTTP,
  a smoke test that starts the real server, and one that spawns `npm start`'s entry point and
  stops it with SIGTERM.
- **Page:** type-checked, exercised by hand (checklist in the design record); not browser-tested.

```bash
npm test               # 129 tests
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
4. **An expiry sweeper** to keep stored state current for reporting.
5. **Backpressure:** fail fast once sold out instead of joining the queue; cap queue length.
6. **Ownership** on confirm and cancel.
7. **Observability:** request ids, structured logs, metrics for rejections and lock wait time.
8. **Operations:** request body limit, health endpoint, rate limiting.

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
