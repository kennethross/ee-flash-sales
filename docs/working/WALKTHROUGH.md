# Walkthrough — Inventory Reservation System

Study guide for the code as built. Read it with the files open, in this order.

## Reading order

1. `src/domain/failures.ts` — `Result`, `ok`, `fail`. Everything else returns these.
2. `src/domain/reservation.ts` — the state machine. Note `expireIfDue` returns the *same object*
   when nothing is due; that identity is used later.
3. `src/domain/product.ts` — `stockCounts` is the brief's formula; `available` is its last field.
4. `src/application/ports.ts` — the three interfaces. The store is async on purpose.
5. `src/infrastructure/mutex.ts` — 44 lines. Read `runExclusive` line by line (below).
6. `src/infrastructure/store.ts` — two Maps; `Promise.resolve` because nothing awaits.
7. `src/application/inventory-service.ts` — every write is `withLock(sku, load → decide → save)`.
8. `src/http/guards.ts` → `src/http/app.ts` → `src/http/server.ts` → `src/main.ts`.
9. `src/web/simulator.ts` — the page; skim, it is a demo harness.

Tests mirror the tree; each `describe` names its requirement (`R1`…`R11` in
`docs/superpowers/specs/2026-09-22-inventory-reservation-design.md` §3).

## The mutex, line by line

```ts
#tail: Promise<void> = Promise.resolve();          // "last in line"; nobody at first

runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = this.#tail.then(task);            // run my task after the last one settles
  this.#tail = result.then(noop, noop);            // I am now last; settles even if I threw
  return result;                                   // my caller gets my outcome, throw included
}
```

Why `then(noop, noop)` and not `result` itself: if `result` rejected and were the tail, the next
`tail.then(task)` would skip its task (rejections skip `then` handlers) and reject too, and the
queue would be dead from that point. `then(noop, noop)` converts either outcome into a resolved
`void`, so the line keeps moving; the caller still receives the rejection through `result`.

## A trace: three callers for one item

Stock 1. Ana, Ben and Cy call `reserve('flash-ticket', …)` in the same tick.

| Step | Who holds the lock | What happens |
|---|---|---|
| 1 | Ana | `withLock` finds no mutex for `flash-ticket`, creates one, `tail` is resolved, Ana's task starts immediately |
| 2 | Ana | Ben's `withLock` chains after Ana's result; Cy's chains after Ben's |
| 3 | Ana | `#load`: `getProduct` (await), `listReservations` (await) — Ben and Cy are parked, not running |
| 4 | Ana | `available` = 1 ≥ 1 → build reservation → `saveReservation` (await) → return `ok` |
| 5 | Ben | Ana's promise settles → Ben's task starts; `#load` now lists Ana's Active reservation |
| 6 | Ben | `available` = 0 < 1 → `fail('OUT_OF_STOCK', 'Only 0 of flash-ticket available; 1 requested.')` — no write |
| 7 | Cy | same as Ben |

Without the lock, steps 3 for all three run before any step 4: all three read "1 available" and all
three write. That is the second concurrency test.

## Why `expireIfDue` returning the same object matters

`#load` does:

```ts
const current = expireIfDue(stored, now);
if (current !== stored) await this.#store.saveReservation(current);
```

Only reservations that actually crossed `expiresAt` are written. With a copy-always function every
load would rewrite every reservation. Identity is the cheapest possible "did anything change".

The same trick in `#transition`: `const next = result.ok ? result.value : expireIfDue(current, now)`
— when confirm fails because the reservation expired, the expiry still gets recorded.

## Expiry, in two places

- `isActive(r, now)` is `state === 'Active' && expiresAt > now`. `stockCounts` uses it, so stock
  returns at `expiresAt` without anyone writing anything.
- Recording (`state: 'Expired'`) happens lazily on the next write to that product, or is shown as the
  effective state by `snapshot()`. The tests in `R6` cover both: "snapshot shows an overdue
  reservation as Expired before any write records it" and "the next write to the product records
  the expiry".

## HTTP layer in one paragraph

`guards.ts` turns `unknown` bodies into typed inputs (shape and JSON type only). `app.ts` has eight
routes, a `respond` helper that maps `Result` to a response through one `STATUS_BY_CODE` table, a
JSON 404 and a JSON 500 (`onError`, reported via an injectable `reportError`). `server.ts` builds the
service with real infrastructure, seeds `flash-ticket`, adds `serveStatic` for `public/`, and
resolves with `{ url, close }` once listening. `main.ts` reads `PORT`, starts it, and closes on
SIGINT/SIGTERM.

## The page

`public/index.html` + `src/web/simulator.ts` (compiled to `public/simulator.js` by
`tsconfig.web.json`). It polls `/api/state` every second. Customers exist only in the page;
reservations live on the server under `userId = customer name`. "Everyone buys now" is one
`Promise.all` of POSTs, so the requests are concurrent for real. Product rows are rebuilt on each
poll; cards are created once and updated in place so the picker keeps its choice.

Manual checklist run on 2026-09-22 against `npm start` (all nine items pass; details in the
journal, Phase 4).

## Likely interview questions

See `docs/DEFENCE-B.md` for draft answers. The ones to be ready for cold: why a Map needs a lock in
Node; show the test that fails without the lock; what breaks across two instances; why expiry is not
a timer; why reload inside the lock.
