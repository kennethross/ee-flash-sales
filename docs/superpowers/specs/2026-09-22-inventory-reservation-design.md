# Design: Inventory Reservation System (EE Challenge B)

- **Date:** 2026-09-22
- **Status:** approved section by section in conversation on 2026-09-22 (see `docs/working/JOURNAL.md`)
- **Brief:** `docs/MISSION.md`, "Challenge B — Inventory Reservation System"
- **Deadline:** 2026-09-23

## 1. Goal and success criteria

**Goal 1.** A reservation service that cannot oversell under concurrent load, with a written locking
strategy a reviewer can follow and Kenneth can defend in a technical round.

**Goal 2.** The simplest design that works and gives the right result. Anything that would make it
production-grade (persistence, more than one instance, idempotency, observability) is written down
as an improvements list in the README and rehearsed as interview material. It is not built.

Success is all of:

1. Every requirement in §3 has at least one test that names it, and all tests pass.
2. The 500-request test (R9) passes with the lock, and its companion without the lock oversells.
3. The README explains the locking strategy: what the lock guarantees, why it is needed in Node,
   where it stops working, and what replaces it.
4. `npm ci && npm test && npm start` works from a fresh clone, and the page from Kenneth's sketch
   runs against the real API.
5. No `any` anywhere; ESLint `strictTypeChecked` is clean; every commit passed the pre-commit hook.

## 2. Scope

**In.** Several products (SKUs), each with its own stock and its own lock · reservations of one or
more units · the four-state lifecycle `Active | Confirmed | Cancelled | Expired` · hold-time expiry,
default 2 minutes · an HTTP API · a static simulator page served by the same process.

**Out, stated in the README.** Persistence · authentication and ownership checks · payments ·
running more than one instance · idempotency keys · rate limiting · a background expiry sweeper.
Each appears in the improvements list (§12).

## 3. Requirements

Each ID is a `describe` block name in the tests.

| ID | Rule | Accepted when |
|---|---|---|
| R1 | `available = totalStock − confirmed − active`, where *active* counts `Active` reservations whose `expiresAt` is later than *now* | A product with total 5, 2 confirmed and 1 active reports 2 available |
| R2 | Reserve succeeds only when `quantity ≤ available`; the result is an `Active` reservation with `expiresAt = now + holdTimeMs` | Reserve 2 of 2 available succeeds; reserve 3 fails |
| R3 | A failed reserve changes nothing | After a failure, `available` is unchanged and no reservation was stored |
| R4 | Confirm moves `Active → Confirmed`; the units are sold for good | After confirm, `available` stays the same and a later cancel fails |
| R5 | Cancel moves `Active → Cancelled` and releases the units at once | After cancel, `available` rises by the reserved quantity |
| R6 | An `Active` reservation with `expiresAt ≤ now` counts as `Expired`: its units are released and confirm fails | With hold 120 000 ms, at t+119 999 ms confirm succeeds; at t+120 000 ms it fails and `available` is back up |
| R7 | Confirm and cancel apply only to `Active` reservations; anything else fails with `INVALID_STATE` naming the current state | Confirm on Cancelled, cancel on Confirmed, confirm on Expired all fail |
| R8 | Hold time defaults to 120 000 ms and is set per service instance; changing it does not touch existing reservations | The default matches the brief; the simulator can set 10 s; an earlier reservation keeps its `expiresAt` |
| R9 | Only one user gets the last item: stock 1 and 500 simultaneous reserves give exactly 1 success and 499 `OUT_OF_STOCK`. At all times `confirmed + active ≤ totalStock` | The 500-request test passes with the lock; the no-lock companion oversells; the mixed-load test never breaks the inequality |
| R10 | Unknown product → `NOT_FOUND`; a quantity that is not a positive integer → `VALIDATION`; a `totalStock` that is not a non-negative integer → `VALIDATION`; reducing `totalStock` below `confirmed + active` → `VALIDATION`; creating an existing SKU → `ALREADY_EXISTS` | One test per case |
| R11 | Every operation is reachable over HTTP with the status codes in §7 | Route tests through `app.request()` |
| R12 | Reset returns the inventory to its seed: every product and reservation removed (each under its lock), hold time back to default, the audit trail restarted, seed products re-created | After reset only the seed exists, `holdTimeMs` is 120 000, the log is `reset` then `product-created`, and an earlier hold can no longer be confirmed |
| R13 | Every action by a person or the inventory is recorded in order as `{ seq, at, type, actor, message }`: `reserved`, `rejected`, `confirmed`, `cancelled`, `expired` (when noticed), `product-created`, `stock-adjusted`, `product-deleted`, `hold-time-changed`, `reset`. The store keeps the latest 200 | A create → reserve → rejected reserve → confirm sequence yields exactly those four events with the right actors; 250 events keep seq 51–250 |

R12 and R13 were added on 2026-09-22 after the first hand-over, with the cart, remove-customer and
activity additions to the page (journal, Phase 6).

**Judgement calls.** R6 puts the boundary at `expiresAt` exactly, so stock is never held a moment
longer than promised. The brief does not say which side the boundary falls on.

## 4. Assumptions

Each is a journal entry; the significant ones become ADRs in Phase 5.

- **B1** — The inventory holds several SKUs. Each SKU has its own stock and its own lock.
- **B2** — A reservation is for `quantity ≥ 1` units, default 1. The brief's examples are single
  units; "reservations exceeding available stock must fail" reads as a quantity rule.
- **B3** — A reservation is expired at `expiresAt` exactly (R6).
- **B4** — There is no authentication. Confirm and cancel take a reservation ID and do not check who
  is calling; `userId` is recorded on the reservation for display and for the simulator.
- **B5** — Hold time is one setting per service instance, changeable at runtime. Reservations keep
  the `expiresAt` they were given.
- **B6** — Reducing `totalStock` below `confirmed + active` is rejected rather than clamped.
- **B7** — Deleting a product deletes its reservations. This exists for the simulator.
- **B8** — The server seeds one product at startup: `flash-ticket`, "Flash Sale Ticket", stock 1.
- **B9** — Reservation IDs come from `crypto.randomUUID()`.
- **B10** — Reads (`snapshot`) do not take locks. The store returns products and reservations in a
  single call, so the view is consistent for an in-memory store.

## 5. Architecture and modules

Four layers. Imports point downward only; `domain` knows nothing about promises, locks, Hono or
the browser.

```
src/
  domain/
    failures.ts            FailureCode union, Failure, Result<T> (ok | fail), helpers ok() / fail()
    product.ts             Sku, Product, ProductView, available(product, reservations, now)   R1
    reservation.ts         ReservationId, UserId, ReservationState, Reservation,
                           isActive(r, now), expireIfDue(r, now), confirm(r, now), cancel(r, now)
  application/
    inventory-service.ts   InventoryService: createProduct, adjustStock, deleteProduct, reserve,
                           confirm, cancel, snapshot, holdTimeMs. The only place a lock is taken.
  infrastructure/
    store.ts               InventoryStore interface + InMemoryStore (Maps). Methods are async.
    mutex.ts               Mutex (promise chain) + KeyedMutex implements LockManager
                           + NoLock implements LockManager (tests only)
    clock.ts               Clock { now(): Date } + SystemClock (+ FakeClock under tests/)
  http/
    app.ts                 createApp(service): Hono app with routes and the code→status table
    guards.ts              unknown → typed request bodies
    server.ts              entry point: wires the pieces, seeds B8, serves public/, listens
  web/
    simulator.ts           browser code, compiled by tsconfig.web.json to public/simulator.js
public/
  index.html               the two-pane page
tests/                     mirrors src/; plus tests/support/fake-clock.ts
```

### Types (domain)

```ts
export type Sku = string;
export type ReservationId = string;
export type UserId = string;

export interface Product {
  readonly sku: Sku;
  readonly name: string;
  readonly totalStock: number;
}

export type ReservationState = 'Active' | 'Confirmed' | 'Cancelled' | 'Expired';

export interface Reservation {
  readonly id: ReservationId;
  readonly sku: Sku;
  readonly userId: UserId;
  readonly quantity: number;
  readonly state: ReservationState;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export type FailureCode =
  | 'OUT_OF_STOCK'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'VALIDATION'
  | 'ALREADY_EXISTS';

export interface Failure {
  readonly code: FailureCode;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: Failure };
```

Domain functions are pure and take `now` as an argument. `expireIfDue` returns the same object when
nothing changes, so callers can detect a transition by identity.

### Ports (application)

```ts
export interface InventoryStore {
  getProduct(sku: Sku): Promise<Product | undefined>;
  saveProduct(product: Product): Promise<void>;
  deleteProduct(sku: Sku): Promise<void>;           // also removes its reservations
  getReservation(id: ReservationId): Promise<Reservation | undefined>;
  saveReservation(reservation: Reservation): Promise<void>;
  listReservations(sku: Sku): Promise<readonly Reservation[]>;
  snapshot(): Promise<{ products: readonly Product[]; reservations: readonly Reservation[] }>;
}

export interface LockManager {
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}
```

### Service

```ts
export class InventoryService {
  constructor(store: InventoryStore, locks: LockManager, clock: Clock, options?: { holdTimeMs?: number });
  get holdTimeMs(): number;
  setHoldTime(ms: number): Result<number>;                                   // VALIDATION if not a positive integer
  createProduct(input: { sku: Sku; name: string; totalStock: number }): Promise<Result<ProductView>>;
  adjustStock(sku: Sku, totalStock: number): Promise<Result<ProductView>>;
  deleteProduct(sku: Sku): Promise<Result<void>>;
  reserve(sku: Sku, userId: UserId, quantity?: number): Promise<Result<Reservation>>;
  confirm(id: ReservationId): Promise<Result<Reservation>>;
  cancel(id: ReservationId): Promise<Result<Reservation>>;
  snapshot(): Promise<Snapshot>;
}

export interface ProductView extends Product {
  readonly confirmed: number;
  readonly active: number;
  readonly available: number;
}

export interface Snapshot {
  readonly now: Date;
  readonly holdTimeMs: number;
  readonly products: readonly ProductView[];
  readonly reservations: readonly Reservation[];   // with effective state (expireIfDue applied in memory)
}
```

Every write is `locks.withLock(sku, async () => { load → decide → save })`. Confirm and cancel look
the reservation up first to learn its SKU, then take that SKU's lock and reload inside it, so the
decision is always made on fresh state.

**Why the store is async when the data is in a Map.** It is what makes the lock do real work in
Node. `await` yields even when the promise is already resolved. Verified on 2026-09-22 with a
throwaway script: a Map-backed async store with no lock sold 500 of 1. With a synchronous Map the
mutex would be decorative and the companion test could not fail.

**Carried over from Challenge A.** Failures as values (a string-literal union of codes, a `Result`
type, no exceptions for domain outcomes); immutable domain objects (`readonly`, new objects on
transition); a `Record<FailureCode, …>` for anything keyed by code.

## 6. Locking strategy and expiry

### The lock

`Mutex` is a promise chain:

```ts
export class Mutex {
  #tail: Promise<void> = Promise.resolve();

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
```

`KeyedMutex` holds `Map<string, Mutex>` and creates a mutex per key on first use. The key is the
SKU, so buyers of product A never wait behind buyers of product B.

The locked section is load → decide → save and nothing else: no logging, no I/O beyond the store.

Properties, each covered by a test in §8:

- **Fair.** First come, first served, by construction of the chain.
- **Deadlock-free.** An operation holds one lock at a time and never takes a second.
- **Failure-safe.** A task that throws does not block the next task; the caller still receives the
  rejection. Domain failures are `Result` values, so throwing is reserved for bugs.
- **Reads do not lock.** `snapshot()` is one store call.
- **Scope: one Node process.** Two instances each have their own `Map` of mutexes and can oversell
  between them. The README's improvements list says what replaces the mutex beyond one process.

### Expiry without timers

A reservation carries `expiresAt = createdAt + holdTimeMs`. Two things use it:

1. `available()` counts a reservation as active only while `expiresAt > now` (R1, R6). Stock
   returns the instant the hold ends; no timer is involved.
2. Whenever a SKU's reservations are loaded inside a lock, `expireIfDue(reservation, now)` moves any
   overdue `Active` one to `Expired` and it is saved. The recorded state catches up the next time
   anyone writes to that product. `snapshot()` applies `expireIfDue` in memory without saving, so the
   page reads "expired" on time even when no write has happened.

Rejected: a `setTimeout` per reservation (never fires after a restart, cannot be tested without
waiting, does not scale to many reservations). A background sweeper goes on the improvements list.

### Hold time

`holdTimeMs` lives on the service, default `120_000`, changed through `setHoldTime`. Existing
reservations keep the `expiresAt` they were given (B5).

## 7. HTTP API and page

### API

JSON in and out, under `/api`. Failures are `{ "error": { "code": FailureCode, "message": string } }`.
One table in `app.ts` maps codes to statuses:

| Code | Status |
|---|---|
| `VALIDATION` | 400 |
| `NOT_FOUND` | 404 |
| `OUT_OF_STOCK`, `INVALID_STATE`, `ALREADY_EXISTS` | 409 |

| Method | Path | Body | OK | Fails with |
|---|---|---|---|---|
| POST | `/api/products` | `{ sku, name, totalStock }` | 201 `ProductView` | 400, 409 exists |
| PATCH | `/api/products/:sku` | `{ totalStock }` | 200 `ProductView` | 404, 400 |
| DELETE | `/api/products/:sku` | | 204 | 404 |
| POST | `/api/products/:sku/reservations` | `{ userId, quantity? }` | 201 `Reservation` | 404, 400, 409 out of stock |
| POST | `/api/reservations/:id/confirm` | | 200 `Reservation` | 404, 409 not Active |
| POST | `/api/reservations/:id/cancel` | | 200 `Reservation` | 404, 409 not Active |
| PUT | `/api/settings/hold-time` | `{ holdTimeMs }` | 200 `{ holdTimeMs }` | 400 |
| GET | `/api/state` | | 200 `Snapshot` (dates as ISO strings; includes `events`) | |
| POST | `/api/reset` | | 200 `Snapshot` after re-seeding (R12) | 400 if the seed is invalid |
| GET | `/` | | `public/index.html` | |

Anything thrown inside a handler (a bug, never a domain outcome) is answered as 500
`{ error: { code: 'INTERNAL', message } }` and reported through an injectable `reportError`.

Malformed JSON or a body that fails the guards → 400 `VALIDATION`. `guards.ts` turns `unknown` into
typed request objects with hand-written checks (non-empty string, integer). No validation library.
The service applies the domain rules (positive quantity, non-negative stock, stock floor).

### Page

`public/index.html` + `src/web/simulator.ts`, compiled by `tsconfig.web.json` (DOM lib, output
`public/simulator.js`, git-ignored). `npm start` builds it, then starts the server.

- **Left pane, Inventory.** Add-product form (name, quantity; SKU derived from the name). One row per
  product: name, total with `−` / `+` buttons (PATCH), Remove (DELETE), and live
  `confirmed / active / available`. Below a divider: hold time in seconds with Apply (PUT) and
  *Reset inventory* (POST `/api/reset`). Below that, **Activity**: the audit trail newest first,
  latest 50 rows, `time · actor · message`, coloured by type.
- **Right pane, Customers.** Buttons *Add customer* and *Everyone adds to cart*. Each card is a
  customer (`Customer 1`, `Customer 2`, … from a counter, so a removed name is never reused) with
  a × that cancels their holds and removes the card; a product picker, a quantity and *Add to cart*
  (reserve); the **cart** = that customer's Active reservations, one line each with a countdown and
  *Remove* (cancel); *Checkout* confirms every line; a `Bought:` line lists Confirmed items; a
  status line shows `cart empty`, `n in cart`, or the rejection message. *Everyone adds to cart*
  sends every card's Add in one `Promise.all`.
- **Live data.** The page polls `GET /api/state` once a second; countdowns tick locally from
  `expiresAt`. Rows, cart lines and activity rows are reconciled by key rather than rebuilt, so a
  button is never swapped out under a click. Customers exist only in the page; their reservations
  exist on the server under `userId = customer name`. Several browser tabs against one server work.
- **Typing.** `fetch().json()` goes through one typed helper; the same ESLint config applies.

## 8. Testing strategy (TDD)

Each test is written, run, and seen to fail for the right reason before its code exists. Test files
mirror the source tree; every `describe` names its requirement ID.

- **Domain (pure, `FakeClock`).** `available()` arithmetic (R1); each transition and each illegal
  transition of the state machine (R4–R7); the exact expiry boundary (t+119 999 ms holds,
  t+120 000 ms expires).
- **Service (real `InMemoryStore` + real `KeyedMutex` + `FakeClock`).** Reserve success and rejection
  and nothing-changes-on-failure (R2, R3); hold time default, override, and existing reservations
  untouched (R8); every R10 case; the brief's own example (stock 1: User A succeeds, User B fails);
  lazy expiry persistence (an overdue reservation is stored as `Expired` after the next write).
- **Concurrency (R9).**
  1. Stock 1, 500 `reserve` calls in one `Promise.all` → exactly 1 `ok`, 499 `OUT_OF_STOCK`,
     `available` 0.
  2. Companion: the same load with `NoLock` → asserts more than one success. Its name says why it
     exists: to prove the first test can fail and that the lock is the reason it does not.
  3. Mixed load: stock 10 on two SKUs, a few hundred interleaved reserve / confirm / cancel calls;
     afterwards `confirmed + active ≤ totalStock` per SKU and `available ≥ 0`.
- **Mutex.** Serialises tasks; preserves submission order; a throwing task neither blocks the next
  nor swallows its error; `KeyedMutex` uses independent queues per key.
- **HTTP (`app.request()`, no socket).** Each route's success shape; each failure code's status;
  malformed body → 400; the 500-request flash sale over HTTP; one smoke test that starts the real
  server on port 0, fetches `/` and `/api/state`, and stops it.
- **Page.** No browser tests. Type-checked by `tsc`; a manual checklist in the walkthrough.
- **Coverage.** `vitest --coverage` over `src/` excluding `src/web/`. Test counts are reported at
  each gate, not predicted.

## 9. Tooling

Copied from Challenge A, then extended.

- Node ≥ 22.13 (`.nvmrc` 24); TypeScript 6; Vitest 5 + `@vitest/coverage-v8`; ESLint 10 +
  `typescript-eslint` 8; Prettier 3; `tsx` for `npm start`.
- Runtime dependencies: `hono` 4.13, `@hono/node-server` 2.1. Nothing else.
- **Typing.** `tsconfig.json` as A's (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `verbatimModuleSyntax`) plus `tsconfig.web.json` for `src/web/` (DOM lib, emits to `public/`).
  ESLint uses `tseslint.configs.strictTypeChecked` and `stylisticTypeChecked` with
  `projectService`, so `no-explicit-any`, the `no-unsafe-*` family and `no-non-null-assertion` are
  errors. `npm run typecheck` runs both tsconfigs.
- **Hooks.** Husky 9.1, wired by the `prepare` script. `.husky/commit-msg` checks
  `^(feat|fix|refactor|test|docs|chore|ci|build|perf)(\([a-z-]+\))?!?: .{1,72}$` on the subject
  line and prints the allowed types on failure. `.husky/pre-commit` runs `format:check`, `lint`,
  `typecheck`, `test`. `--no-verify` is never used.
- **CI.** GitHub Actions on Node 22 and 24: `npm ci`, format check, lint, typecheck, test.
- **Scripts.** `start` (`build:web` then `tsx src/http/server.ts`), `build:web`, `test`,
  `test:watch`, `test:coverage`, `lint`, `format`, `format:check`, `typecheck`, `prepare`.

## 10. Git history

Repository initialised in this folder in Phase 0 with a repo-local identity (`k5hr2s`,
`kennethrosspalermo@gmail.com`); the global identity is untouched. One behaviour per commit,
conventional subjects enforced by the hook. Internal documents (`docs/MISSION.md`, `docs/working/`,
`docs/superpowers/`, `docs/DEFENCE-B.md`) are committed in separate `docs(internal):` commits so
they can be dropped before the first push. Nothing is pushed or sent by the AI.

## 11. Phases and gates

Kenneth set **"finish all"** on 2026-09-22: phases run back to back. Each still ends with a gate
package — a short report, the real test count, the commits, journal entries, and a walkthrough
section — so each can be checked afterwards.

| Phase | Builds |
|---|---|
| 0 Foundations | `git init`, identity, toolchain, Hono, both tsconfigs, ESLint strict, Husky hooks, CI, scripts; toolchain green with 0 tests; first `docs(internal):` commit with this spec, the journal and the mission |
| 1 Domain | `failures.ts`, `product.ts`, `reservation.ts`, `clock.ts`, `FakeClock` |
| 2 Core | `store.ts`, `mutex.ts`, `InventoryService`, the three concurrency tests |
| 3 API | `guards.ts`, `app.ts`, `server.ts`, route tests, smoke test |
| 4 Page | `index.html`, `simulator.ts`, `npm start` end to end, manual checklist run once |
| 5 Write-up | README (approach, locking strategy, assumptions, AI disclosure, improvements), 3 ADRs, `docs/DEFENCE-B.md`, rubric review, fresh-clone check |

## 12. Improvements list (seed for the README and the interview)

Each item names the limit in this submission and what replaces it.

1. **Persistence.** The store is a `Map`; a restart loses everything. Replace `InMemoryStore` with a
   database-backed one behind the same interface.
2. **More than one instance.** The mutex is per process. Move the decision into the store: a
   conditional `UPDATE … WHERE available >= quantity`, `SELECT … FOR UPDATE`, an atomic Redis
   operation, or one writer per SKU through a partitioned queue. A distributed lock (Redlock) is the
   literal translation but needs fencing tokens; an atomic store write is safer.
3. **Idempotency.** A client that retries a timed-out `reserve` can hold two reservations. Accept an
   `Idempotency-Key` and return the first result.
4. **Expiry sweeper.** Expiry is computed on read and persisted on the next write. A periodic sweep
   keeps the stored state current for reporting.
5. **Backpressure.** Once a SKU is sold out, fail fast before joining the queue; cap queue length.
6. **Ownership and auth.** Confirm and cancel should require the reserving user.
7. **Observability.** Structured logs with request IDs; metrics for reservations, rejections and
   lock wait time.
8. **Validation at scale.** Hand-written guards are fine for eight routes; a schema library once
   payloads grow.
9. **Operations.** Health endpoint, graceful shutdown, rate limiting for flash-sale traffic.

## 13. Open items (do not block implementation)

- Which of A and B is submitted (Kenneth, after both exist).
- Whether to ask the recruiter for an extension.
- Which internal documents ship with the chosen submission.
