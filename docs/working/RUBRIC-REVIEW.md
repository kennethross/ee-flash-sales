# Inventory Reservation System — Rubric Review (2026-09-22)

Reviewer: the `/rubric-reviewer` protocol (Ibiki Morino), run by the same AI session that built the
code. That is a caveat: an independent reader would be a better examiner. Judged from the brief in
`docs/MISSION.md`, not from the code's own tests. Reviewed at `fc8d296` (end of Phase 4); fixes
landed on top and were rechecked.

## Criteria (verbatim from the brief)

- C1 Problem-solving approach and overall solution design
- C2 Code structure and maintainability
- C3 Correctness and completeness of requirements
- C4 Edge case handling
- C5 Test coverage and quality
- C6 Error handling
- C7 Git commit history
- C8 Overall production readiness

Plus the challenge's own evaluation line: correctness · concurrency handling · expiry logic · code
quality · **clear locking-strategy explanation** (folded into C1 and C3).

## Expected behaviour re-derived from the brief

- Level 1: in-memory inventory, reserve, reject when stock is unavailable.
- Level 2: `Active | Confirmed | Cancelled | Expired`; hold 2 minutes; confirm completes the purchase;
  cancel or expiry releases; stock 1 → User A succeeds, User B fails.
- Level 3: stock 1, 500 simultaneous requests → 1 success, 499 failures.
- Rules: `available = total − confirmed − active`; reservations exceeding available fail; confirmed
  purchases cannot be reversed; only one user can reserve the last item; expired reservations
  release automatically.

Each was run against the program (tests named `R1`–`R11`, the `curl` smoke in the journal, and the
page in Chrome) and holds.

## Scorecard (after fixes)

| # | Criterion | Score /5 | Justification |
|---|---|---|---|
| C1 | Problem-solving approach and overall solution design | 5 | Four layers, one place a lock is taken, expiry as a function of time; the locking strategy is demonstrated by a test that fails without the lock and explained in the README |
| C2 | Code structure and maintainability | 5 | Imports point downward; domain is pure and synchronous; every file has one job; no `any`, ESLint `strictTypeChecked` clean |
| C3 | Correctness and completeness of requirements | 5 | Every rule and level in the brief has a named test; the brief's own examples pass |
| C4 | Edge case handling | 5 | Exact expiry boundary, failed writes change nothing, stock floor, unsafe integers, malformed JSON, unknown routes, mixed concurrent load |
| C5 | Test coverage and quality | 5 | 119 tests; three concurrency tests including the no-lock companion; HTTP through `app.request()`; real server and entry point smoke tests; 96.4% lines |
| C6 | Error handling | 5 | Domain outcomes are `Result` values; one code→status table; unexpected errors are a JSON 500 with nothing leaked and are reported |
| C7 | Git commit history | 5 | One behaviour per commit, conventional subjects enforced by a hook, every commit green by the pre-commit hook |
| C8 | Overall production readiness | 4 | Single process, in memory, by design and stated; graceful shutdown, CI on two Node versions, fresh-clone check; no persistence, no auth, no body limit |

## Findings

### R-001: Unexpected errors answered as `text/plain` 500
- **Criterion:** C6
- **Severity:** MINOR
- **Evidence:** at `fc8d296`, `src/http/app.ts` had no `onError`; a thrown error inside a handler
  produced Hono's default `Internal Server Error` text, not the `{ error: { code, message } }`
  shape documented for every other failure.
- **What a grader concludes:** the error contract has a hole that clients cannot parse.
- **Fix:** `67a1125` — `app.onError` returns `{ error: { code: 'INTERNAL', message } }` with 500 and
  reports the error through an injectable `reportError` (default `console.error`). Test-first.

### R-002: Integers beyond `Number.MAX_SAFE_INTEGER` accepted
- **Criterion:** C4
- **Severity:** MINOR
- **Evidence:** `Number.isInteger(2 ** 53)` is `true`; `totalStock: 2 ** 53` was accepted and the
  stock arithmetic would lose precision silently.
- **What a grader concludes:** validation is thinner than it looks.
- **Fix:** `5c86bdd` — `Number.isSafeInteger` in both validators, with tests for stock, adjust and
  quantity.

### R-003: No graceful shutdown
- **Criterion:** C8
- **Severity:** MINOR
- **Evidence:** `src/main.ts` never called `server.close()`; SIGTERM killed in-flight requests.
- **What a grader concludes:** not something you would deploy behind an orchestrator.
- **Fix:** `785bb23` — SIGINT/SIGTERM close the server, then exit 0.

### R-004: Entry point had no automated test
- **Criterion:** C5
- **Severity:** MINOR
- **Evidence:** `startServer` was tested, `src/main.ts` was not; a broken import there would pass
  the suite and fail `npm start`.
- **Fix:** `785bb23` — `tests/main.test.ts` spawns `tsx src/main.ts` with `PORT=0`, reads the URL
  it prints, fetches `/api/state`, sends SIGTERM and asserts exit code 0.

### R-005: Expiry is recorded lazily
- **Criterion:** C3
- **Severity:** NOTE
- **Evidence:** `InventoryService.#load` records `Expired` on the next write to that product;
  `snapshot()` reports the effective state without writing. Stock is released the instant the hold
  ends (`available()` uses `expiresAt > now`), so the brief's rule holds; only the stored label lags.
- **Expect the question:** "how do expired reservations get released?" Answer in `DEFENCE-B.md` Q8.

### R-006: No request body limit, health endpoint or rate limiting
- **Criterion:** C8
- **Severity:** NOTE
- **Evidence:** `createApp` registers no `bodyLimit` middleware and no `/health`.
- **Disposition:** improvements list in the README; out of scope for "simplest thing that works".

### R-007: The page is one file and has no automated tests
- **Criterion:** C2 / C5
- **Severity:** NOTE
- **Evidence:** `src/web/simulator.ts`, ~330 lines; manual checklist only.
- **Disposition:** defensible for a demo harness; stated in the README's testing section.

### R-008: No README at review time
- **Criterion:** C1, C8
- **Severity:** MAJOR
- **Fix:** written in Phase 5 (`README.md`) with the locking strategy, assumptions, testing,
  improvements and AI disclosure.

### R-009: Deleting a product deletes its active reservations
- **Criterion:** C3
- **Severity:** NOTE
- **Evidence:** `InMemoryStore.deleteProduct` removes the product's reservations (assumption B7).
- **Disposition:** stated in the README's assumptions; exists for the simulator.

### R-010: Internal docs in the history
- **Criterion:** C7
- **Severity:** NOTE
- **Evidence:** `docs(internal):` commits carry the journal, spec and plan.
- **Disposition:** intentional (they back the AI disclosure) and separable; Kenneth decides what
  ships (see `SUBMISSION-CHECKLIST.md`).

## Top three improvements (beyond this submission)

1. Move the reservation decision into a shared store so more than one instance can run.
2. Idempotency keys on `reserve`, so client retries cannot hold stock twice.
3. A body limit and a health endpoint, which are two middleware lines but matter behind a proxy.

## Verification performed

- `npm test` → 119 passed in 13 files (after fixes; 115 in 12 before).
- `npm run test:coverage` → 96.4% lines, 93.5% branches, 98.6% functions on `src/` (page excluded;
  the one uncovered function is the default `console.error` reporter).
- `npm run lint`, `npm run typecheck` (both tsconfigs), `npm run format:check` → exit 0.
- `git log --oneline` → 20 commits at the time of this review (the write-up commits follow), every
  subject accepted by the `commit-msg` hook; the hook was seen to reject a bad subject and an
  over-long one during the build.
- Mutation check: `KeyedMutex.withLock` replaced by `task()` → the 500-request test and the
  mixed-load test fail; restored → pass.
- Page checklist (nine items) run in Chrome against `npm start`; no console errors.
