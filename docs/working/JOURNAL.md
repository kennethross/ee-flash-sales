# Working Journal — EE Coding Challenge B (Inventory Reservation System)

Append-only, written live. Entry types: `INPUT` (something Kenneth said or supplied) ·
`DECISION` (a choice, with who made it) · `ASSUMPTION` (a gap in the brief and how it was closed) ·
`AI` (what an AI tool did) · `GAP` (unknown, not yet resolved).

AI tooling throughout: **Claude Code** (Anthropic's CLI agent), model Claude Fable 5.1.

Challenge A (Robot Work Allocation) was built first, in `~/Documents/projects/ee`; its journal lives
there. This folder started as a copy of A's `docs/`; A's copies were deleted on 2026-09-22 (below).

---

## 2026-09-21

- **INPUT** — Kenneth: "i wanna work on the challenge B".
- **DECISION (Kenneth)** — Purpose of B: build it to submission quality, then pick the stronger of A
  and B to submit. Rejected alternatives: replace A outright; treat B as interview practice only;
  submit both (the brief says "Choose ONE").
- **INPUT** — Kenneth: "Im not familiar with Go. my main language is Typescript but i dont think TS
  have a native lock".
- **AI** — Withdrew an initial Go recommendation: understanding is a deliverable and Kenneth would be
  defending an unfamiliar language live.
- **AI** — Throwaway demo on Node v24.12.0, stock 1 and 500 simultaneous requests: synchronous
  in-memory check-then-write sold 1 (cannot race on one thread); an `await` between read and write
  sold 500; a ten-line promise-chain mutex sold 1; `navigator.locks` sold 1. Conclusion recorded: in
  Node, races come from `await` points, so the concurrency work is only real behind an async storage
  boundary, and the README must say so.
- **INPUT** — Kenneth: "is this scalable? what happened if we run this in microservice?"
- **AI** — Throwaway demo with 4 Node processes sharing one store: a per-process mutex sold 4 of 1
  (oversold, both runs); one atomic claim in the shared store sold 1 of 1. Conclusion recorded: the
  in-process mutex is correct for one process and the right size for the brief ("inventory in
  memory"); at scale the lock moves into the store (conditional `UPDATE`, `SELECT … FOR UPDATE`,
  atomic Redis op, or one writer per SKU). This goes in the README's locking-strategy section.
- **INPUT** — Kenneth: "do we have a spec driven design?"
- **AI** — Answered: A has a spec; B does not yet. Proposed one spec in A's style plus a requirements
  section with IDs and acceptance criteria that tests trace back to, kept to about eight sections.

## 2026-09-22

- **DECISION (Kenneth)** — Language and locking: TypeScript, async promise-chain mutex, single-process
  scope. Scale-out is documented, not built.
- **GAP** — Deadline is 2026-09-23. B must be built and the A-vs-B choice made inside that window;
  an extension request remains Kenneth's option.
- **DECISION (Kenneth)** — Deliverable shape: library + HTTP API (chosen over library + demo script,
  and over a CLI like A's).
- **DECISION (Kenneth)** — HTTP layer: Hono 4.13 with `@hono/node-server`, kept as a thin adapter.
- **AI** — Proposed three code structures: (1) service over an async repository with one mutex per
  SKU, expiry computed on read; (2) one writer per SKU, actor style; (3) synchronous in-memory core
  with no lock. Recommended (1); (2) becomes the README's scale-out story.
- **INPUT** — Kenneth supplied a notebook sketch (`~/Downloads/IMG_9225.HEIC`) for "the UI part":
  a left pane labelled "Inventory Monitoring / Configuration" (add/remove items, per-item +/−
  stock, "Reserved Time" below a divider) and a right pane labelled "Customer Card Pane" (one card
  per customer stacked vertically, a dashed "+" box to add a customer). The brief does not ask for
  a UI.
- **INPUT** — Kenneth: "left pane, is the configuration where we can add items and its quantities,
  reserved time. right pane is where we can have a multiple window to simulate ppl buying the items".
- **AI** — Read as: a flash-sale simulator page. Left: product config (add, quantity +/−, remove) plus
  an editable hold time (default 120 s per the brief) and live per-product numbers. Right: customer
  cards with Buy / Confirm / Cancel, status and countdown, "+" to add a customer, and an
  "everyone buys now" control that fires all Buys at once as real concurrent HTTP requests. Flagged
  the cost (~2–3 h for a static page) against the 2026-09-23 deadline; UI is built last, after the
  API and tests.
- **DECISION (Kenneth)** — Simulator page: static `index.html` plus a browser module written in
  TypeScript and compiled with `tsc`, served by the same Hono server, polling the API. No bundler,
  no framework, no new runtime dependencies. Rejected: Vite + React; deferring the UI.
- **DECISION (Kenneth)** — Design §1 approved ("lgtm"): goal, scope, requirements R1–R11 with
  acceptance criteria. Includes the call that a reservation is expired at `expiresAt` exactly (R6).
- **INPUT** — Kenneth, on the §2 draft: "wait, do we need redis or postgres? lets make this as simple
  as possible. add this goal, we make it simple and leave the improvement when im in the technical
  interview. you help me on discussing on the solution on what we can improve and make this
  production level. for now we make this thing works and the result is right."
- **DECISION (Kenneth)** — New goal, added to §1: the simplest design that works and gives the right
  result. Production hardening (persistence, multi-instance locking, idempotency, observability) is
  a written discussion list for the technical interview, not code.
- **AI** — Clarified: no Redis or Postgres was ever going to be installed or coded; they were named
  only to explain why the store's methods are async. Storage is one `Map`. Trimmed the module map.
- **DECISION (Kenneth)** — Design §2 approved ("lgtm"): four layers, ten source files, interfaces
  only for clock, lock and store; store methods stay async so the lock does real work in Node.
- **DECISION (Kenneth)** — Design §3 approved ("lgtm"): one promise-chain mutex per SKU around
  load → decide → save; reads don't lock; expiry computed from `expiresAt` on read, persisted
  lazily on the next write to that SKU; no timers; `holdTimeMs` changeable at runtime.
- **DECISION (Kenneth)** — Design §4 approved ("lgtm"): eight JSON routes under `/api`, one
  code→status table, hand-written input guards, seeded "Flash Sale Ticket" (stock 1); static page
  built by a second tsconfig, polling `/api/state` each second; "Everyone buys now" = one
  `Promise.all`. Page is built last.
- **DECISION (Kenneth)** — Design §5 approved ("lgtm"): TDD; tests named by requirement ID;
  three concurrency tests including the no-lock companion that must oversell; HTTP tests via
  `app.request()`; one real-server smoke test; no browser tests for the page.
- **INPUT** — Kenneth, on the §6 draft: "few more things need to add, conventional commit, either
  .husky or right hook" and "strong typing, no Any".
- **AI** — Added to §6: Husky 9.1 with a `commit-msg` regex hook (no commitlint) and a `pre-commit`
  hook running format check, lint, typecheck and tests; ESLint `strictTypeChecked` +
  `stylisticTypeChecked` (so `no-explicit-any`, `no-unsafe-*` and `no-non-null-assertion` are
  errors); request bodies read as `unknown` and narrowed by guards. Checked A's source: no `any`.
- **DECISION (Kenneth)** — Design §6 approved with the addendum ("lgtm, finish all"): six phases,
  A's git conventions, deletion of A's doc copies from this folder, and **"finish all"** — the
  remaining phases run without stopping at each gate; gate packages are still written per phase.
- **AI** — Verified with `diff -rq` that every A doc copy here was byte-identical to the original in
  `~/Documents/projects/ee` (only this journal differed), then deleted `docs/adr/`,
  `docs/DEFENCE.md`, `docs/superpowers/`, `docs/working/RUBRIC-REVIEW.md`,
  `docs/working/SUBMISSION-CHECKLIST.md`, `docs/working/WALKTHROUGH.md`. Kept `docs/MISSION.md`
  (both briefs). Trimmed this journal to B's entries.
- **AI** — Verified before writing the spec: a Map-backed store with `async` methods and no lock sold
  500 of 1 under 500 concurrent calls (throwaway script). So the no-lock companion test fails for the
  right reason without artificial delays.
- **AI** — Wrote the design spec: `docs/superpowers/specs/2026-09-22-inventory-reservation-design.md`
  (13 sections: goals incl. simplicity, scope, R1–R11, assumptions B1–B10, modules with types,
  locking and expiry, API and page, testing, tooling incl. hooks and typing, git, phases,
  improvements list for the interview, open items). Self-review: no placeholders; codes, routes and
  types consistent across sections; single plan scope; defaults (quantity 1, hold 120 000 ms, expiry
  at the boundary) stated once each.
- **ASSUMPTION B1–B10** — Recorded in spec §4: several SKUs · quantity ≥ 1 default 1 · expired at
  `expiresAt` exactly · no auth or ownership check · hold time per instance, existing reservations
  untouched · stock floor rejected not clamped · deleting a product deletes its reservations ·
  seeded `flash-ticket` stock 1 · UUID ids · reads don't lock.
- **DECISION (Claude, per "finish all")** — Proceeding to the implementation plan and build without
  a separate spec-review stop. Every section was approved in conversation; the spec is the written
  form of those approvals and can be read at any time.
- **AI** — Wrote the implementation plan: `docs/superpowers/plans/2026-09-22-inventory-reservation.md`
  (16 tasks in 6 phases, every code file and test in full). One deviation from the spec's file
  list: the three port interfaces live in `src/application/ports.ts`, not in infrastructure, so
  imports only ever point downward.
- **AI** — Verified the plan before hand-over by extracting every code block into a throwaway tree
  with the exact dependency versions: `tsc --noEmit` clean on both tsconfigs; ESLint
  `strictTypeChecked` clean after two fixes folded back into the plan (`dot-notation` in
  `guards.ts`; `withResolvers<void>` in the mutex test replaced by a two-tick ordering test);
  Prettier clean; **115 tests in 12 files passing**, including the no-lock companion (oversold as
  intended) and the 500-request sale over HTTP; coverage 96.7% lines / 93.3% branches / 100%
  functions on `src/` (uncovered: three guard branches, two `app.ts` guard-failure branches, the
  server's seed-failure and close-error paths). Predicted test counts in the plan corrected to the
  real ones.
- **AI** — Ran the page from the throwaway tree in Chrome (extension tools): three cards idle →
  "Everyone buys now" gave one `reserved … expires in 1:57` and two `Only 0 of flash-ticket
  available; 1 requested.`; Confirm → `confirmed`; added Mug (2) → appeared in every picker; hold
  time 5 s → Customer 2's Mug reservation counted down `0:04` → `expired · Mug` and Mug's Available
  returned to 2. No console errors. Checklist items 1–5 of plan Task 14 pass before the build.
- **DECISION (Claude, no objection raised)** — Plan executed inline in this session rather than by
  per-task subagents, as for Challenge A: the code is already verified and the walkthrough benefits
  from one context.

### Phase 0 — Foundations

- **AI** — `git init -b main`; repo-local identity `k5hr2s <kennethrosspalermo@gmail.com>` (global
  untouched). Installed the toolchain at A's versions plus Hono 4.13, `@hono/node-server` 2.1 and
  Husky 9.1; `npm audit` 0 vulnerabilities. Prettier, ESLint (`strictTypeChecked`), both tsconfigs
  and `vitest --passWithNoTests` all exit 0 with no source yet.
- **AI (deviation)** — Vitest exits 1 when there are no test files, which would have blocked the
  scaffold commits at the pre-commit hook. `test` script is `vitest run --passWithNoTests`; a no-op
  once tests exist. Recorded here rather than weakening the hook.
- **AI** — Proved the hooks before the first real commit: `git commit -m "bad subject line"` was
  refused by `commit-msg` with the allowed types printed. Four commits: scaffold, hooks, CI,
  internal docs (`0c42f14`, `2fd7c0a`, `183f403`, `caeed91`).

### Phase 1 — Domain

- **AI** — Built test-first in four commits: `Result` (`bea92bf`) · reservation state machine
  (`4543443`) · product stock arithmetic (`d8ff2bc`) · ports and clocks (`11e7cc9`). Each test file
  was run and seen to fail for the right reason (module not found; `stockCounts is not a function`)
  before its implementation was copied in from the verified plan.
- **AI** — Phase 1 result: 27 tests in 4 files passing; ESLint, `tsc --noEmit` (both configs) and
  Prettier clean.

### Phase 2 — Core

- **AI** — Built test-first: mutex (`f8fafdf`, 6 tests) · in-memory store (`f1aeb95`, 4) · service
  with products and snapshot (`ad98ca2`, 16) · reservation lifecycle tests (`341e391`, 22; no
  production change needed) · concurrency tests (3).
- **AI (mutation check)** — With `KeyedMutex.withLock` changed to `return task()`, the 500-request
  test and the mixed-load test both failed; the no-lock companion (which expects an oversell) is the
  one that passed. File restored from git; all three green again. Worth saying in an interview:
  the concurrency tests were seen to fail when the lock was removed.
- **AI** — The concurrency commit was refused once by our own `commit-msg` hook: the summary was 76
  characters against the 72 limit. Shortened; plan updated to match. The hook works on the author
  too.
- **AI** — Phase 2 result: 78 tests in 9 files passing; ESLint, `tsc --noEmit` and Prettier clean.

### Phase 3 — HTTP API

- **AI** — Built test-first: guards (`623aa68`, 15 tests) · routes (`345e2fa`, 20, including the
  500-request sale over `app.request()`) · server, entry point and a placeholder page (`1e36ca0`,
  2). Hono's `c.json` accepted `unknown` and serialised `Date` fields as ISO strings, so no wire
  DTO was needed.
- **AI** — Smoke through the real entry point (`PORT=3999 npx tsx src/main.ts`): `/api/state` lists
  the seeded `flash-ticket`; ana's reservation returns 201 Active; ben's returns
  `{"error":{"code":"OUT_OF_STOCK","message":"Only 0 of flash-ticket available; 1 requested."}}`.
- **AI** — Phase 3 result: 115 tests in 12 files passing; ESLint, `tsc --noEmit` and Prettier clean.

### Phase 4 — Simulator page

- **AI** — Installed the page (`fc8d296`): `public/index.html` and `src/web/simulator.ts`, compiled
  by `tsconfig.web.json` to `public/simulator.js` (git-ignored, 11.6 kB). `npm start` on port 3996
  built and served both. Lint, typecheck, Prettier and the 115 tests unchanged.
- **AI** — Manual checklist (plan Task 14 step 5) run against the real server in Chrome, all nine
  items: (1) loads connected with three idle cards; (2) "Everyone buys now" → one `reserved … 1:5x`,
  two `Only 0 of flash-ticket available; 1 requested.`, Available `0` in red; (3) Confirm → green
  `confirmed`; (4) Mug (2) added and in every picker, `+`/`−` change Total; (5) hold time 5 s →
  countdown `0:04` → `expired · Mug`, Available back; (6) Cancel → `cancelled · Mug`, Available up;
  (7) two more customers, second flash sale → both Mugs sold, the rest refused; (8) Remove Mug →
  its cards back to `idle` on the next poll; (9) second tab shows the same state. No console
  errors in either tab. Items 1–5 had also passed on the verification tree before the build.
- **AI (observation, not a bug)** — Product rows are rebuilt on every one-second poll, so a browser
  automation reference to a row button goes stale within a second; a human click always lands on
  the current element. Left as is; a keyed diff is not worth the code for a demo page.

### Phase 5 — Write-up

- **AI** — Ran the `/rubric-reviewer` protocol against EE's eight criteria before writing the
  README, so accepted fixes land before the figures are quoted. Report:
  `docs/working/RUBRIC-REVIEW.md` (caveat recorded there: same AI session as the builder).
  Findings and dispositions, each fix test-first and one commit:
  - R-001 MINOR — unexpected errors answered as Hono's `text/plain` 500. Fixed (`67a1125`):
    `app.onError` → JSON `{ error: { code: 'INTERNAL', … } }` with an injectable `reportError`.
  - R-002 MINOR — `Number.isInteger(2 ** 53)` passes validation. Fixed (`5c86bdd`): `isSafeInteger`.
  - R-003 MINOR — no graceful shutdown. Fixed (`785bb23`): SIGINT/SIGTERM close the server, exit 0.
  - R-004 MINOR — entry point untested. Fixed (`785bb23`): `tests/main.test.ts` spawns
    `tsx src/main.ts` with `PORT=0`, fetches `/api/state`, sends SIGTERM, asserts exit 0.
  - R-005…R-010 NOTE — lazy expiry recording, no body limit/health/rate limit, single-file page,
    delete-removes-reservations, internal docs in history: documented (README, ADR 0003,
    DEFENCE-B), not changed.
- **AI** — Rubric fixes result: 119 tests in 13 files passing; coverage 96.4% lines, 93.5%
  branches, 98.6% functions (the uncovered function is the default `console.error` reporter);
  ESLint, `tsc --noEmit` and Prettier clean.
- **AI** — Wrote `README.md` from figures taken from the commands right before (119 tests,
  coverage above, 44-line mutex); locking strategy section explains the problem, the lock, what is
  inside it, its properties and where it stops. AI disclosure states that all code, tests and
  first-draft docs were AI-generated under Kenneth's direction, which decisions were his, what he
  checked, and where the AI was corrected (Go; Redis/Postgres).
- **AI** — Wrote three ADRs (`docs/adr/`): async store as the seam · one promise mutex per SKU ·
  expiry computed on read. Wrote `docs/DEFENCE-B.md` (20 draft answers, two left for Kenneth),
  `docs/working/WALKTHROUGH.md` (reading order, the mutex line by line, a three-caller trace, why
  `expireIfDue` identity matters) and `docs/working/SUBMISSION-CHECKLIST.md` (now starting with the
  A-or-B decision).
- **AI** — Committed the write-up: `5b3e0e8 docs: README …` (README + ADRs, ships) and
  `a9b6933 docs(internal): …` (defence notes, walkthrough, rubric review, checklist, journal, plan).
- **AI** — Fresh-clone check on 2026-09-22 at `a9b6933`: cloned into an empty directory, `npm ci`
  (0 vulnerabilities), Prettier clean, ESLint exit 0, `tsc --noEmit` exit 0 on both tsconfigs,
  **119 tests passed in 13 files**, `npm run build:web` then the entry point served `/api/state`
  and the page (`Flash Sale Simulator`) from the clean checkout. Temporary clone deleted.
- **GAP (Kenneth only)** — Not done, by design: choosing A or B; `/grill-me` sessions; rewording
  `DEFENCE-B.md`, the README and commit subjects in his own voice; deciding what ships;
  pushing/submitting. Nothing has been pushed or sent anywhere.

### Phase 6 — Page additions (requested after hand-over)

- **INPUT** — Kenneth, on seeing the finished build: "i think we need to add few more things
  1. Add into cart 2. Remove customer pane 3. Reset Inventory". Clarifying questions asked before
  any design.
- **DECISION (Kenneth)** — Cart = the customer's active holds: "Add to cart" reserves, cart lines
  are that customer's Active reservations with a countdown and a per-line Remove (cancel),
  "Checkout" confirms every line. Rejected: page-only cart that reserves at checkout (hides the
  flash-sale point); server-side atomic multi-SKU cart (a real domain change, half a day).
- **DECISION (Kenneth)** — Remove one customer card via a × on the card; it cancels that customer's
  active holds first. Rejected: clear-all button; hiding the whole pane.
- **DECISION (Kenneth)** — Reset via a server endpoint `POST /api/reset` that clears every product
  and reservation, re-seeds the demo product and restores the default hold time; a button in the
  Inventory pane calls it. Rejected: page-only reset through N deletes; reservations-only reset.
- **INPUT** — Kenneth: "and 1 more thing, in the configuration pane, i wanna see an audit of list of
  ppl activities".
- **AI** — Proposed a server-side activity log rather than deriving it from reservations, because
  the reservations alone cannot show rejected attempts (the flash-sale outcome) or when a
  transition happened.
- **DECISION (Kenneth)** — "go" on the four-item design: cart = active holds with Checkout; × per
  customer card (cancels holds first); `POST /api/reset` re-seeding the demo product; a server-side
  activity log (`seq, at, type, actor, message`, latest 200 kept, in `Snapshot.events`) shown newest
  first in the Inventory pane. Spec gains R12 (reset) and R13 (activity). Build runs to completion.
- **AI** — Server side test-first (`503b8ef`): 10 new tests written and seen failing (module not
  found; `events` absent; no `/api/reset`), then `activity.ts`, store `appendEvent`/`clearEvents`
  with a 200-event cap, `#record` in the service inside the lock after each save, `reset(seed)`,
  `POST /api/reset`, `createApp({ seed })`. `setHoldTime` became async so it can be recorded. One
  commit for both R12 and R13 because they touch the same service file and route file; splitting
  would have needed hunk-level staging the pre-commit hook cannot verify per commit.
- **AI** — Page (`32111b0`): cart lines, Checkout, × per card, Reset inventory, Activity list,
  quantity per line, customer names from a counter. Added `reconcile()` (keyed DOM updates) so rows,
  lines and activity entries are not rebuilt each poll — that also removes the Phase 4 observation
  about stale row buttons. Three bugs found and fixed in Chrome before commit: the order row
  overflowed the card (grid columns); the activity text inherited the orange `.message` rule
  (renamed to `.text`); after a reset the activity rows were reused because `seq` restarts
  (key is now `seq@at`). One lint error (`no-unnecessary-condition`) because TS 5.5+ infers a type
  predicate from `find((r) => !r.ok)`; simplified. Verified: sale (1 reserved, 2 rejected, both in
  the log), two-line cart and checkout (`Bought: 1 × Flash Sale Ticket, 2 × Mug`), remove a customer
  with a Mug hold (cancelled, stock back), reset (log restarts as `reset`, `product-created`).
  A "lost" click during the check was a stale automation reference, re-tested by coordinates.
- **AI** — Phase 6 result: 129 tests in 14 files passing; ESLint, `tsc --noEmit` and Prettier clean;
  coverage 96.9% lines, 93.8% branches, 98.8% functions. README, spec (R12, R13, routes, page),
  walkthrough, DEFENCE-B (Q21 on the audit trail), checklist, rubric review and plan updated.
- **AI** — Fresh-clone check at `08d0e96`: `npm ci` (0 vulnerabilities), Prettier, ESLint,
  `tsc --noEmit` ×2 all clean, **129 tests passed in 14 files**, `POST /api/reset` answered from
  the clean checkout and the page served with the new toolbar. Temporary clone deleted.
- **GAP (Kenneth only)** — Unchanged: choose A or B; `/grill-me`; reword in his voice; decide what
  ships; push/submit by 2026-09-23. Nothing has been pushed or sent anywhere.

## 2026-09-23

- **INPUT** — Kenneth: "looks good. few questions 1. do we manage to fulfill the requirements
  2. what else we need to do? 3. WHere can we host this for free?"
- **AI** — Answered: every brief item mapped to a test or file (with three stated caveats:
  single-process lock, lazy expiry recording, page not browser-tested); what remains is his
  (choose A or B, own the code, decide what ships, push and submit); hosting must be a
  single-instance host (Render free or Cloud Run `--max-instances=1`), serverless would oversell.
- **INPUT** — Kenneth: "oh i wanna add 1 more thing, add queue for items that is checked out".
  A clarifying question was started; Kenneth interrupted and restated the feature.
- **INPUT** — Kenneth: "ok maybe lets do this instead. a feature where we wanna sell a particular
  item that is coming soon. so customer can go checkout first and be put on queue. eg an item is
  being to be put on display but can only be buy on 12am midnight. customer can go to the website
  and join the waiting list. then when a the time reached at 12am midnight, the item will be
  automatically checkout to that person and there is reserved time. if they didnt proceed to buy,
  it will go to the next person in line. lets polish this a bit and check out any edge cases we
  need to handle".
- **AI** — Read as: a product with a release time; a per-product FIFO waiting list before (and
  after) release; at release the first in line automatically get a hold for the hold time; a hold
  that expires or is cancelled passes the item to the next in line. Design and edge cases
  presented before any code; deadline (today) flagged.
- **DECISION (Kenneth)** — One unit per waiting-list entry, one place per person per product
  (rejected: quantities with skip-to-fit). While anyone is waiting, direct Add to cart is refused
  and the card offers "Join waiting list" (rejected: first come between queue and buyers).
- **INPUT** — Kenneth: "dont worry about the deadline. i already submit. this is just for my own.
  build all". The challenge has been submitted; this repository continues as his own project and
  interview material with the same discipline. Which challenge was submitted is not recorded here.
- **DECISION (Claude)** — Timing by a single one-second server sweeper calling
  `processWaitlists()` (idempotent, one lock per product per pass), plus promotion inline after
  every write to a product. Not a timer per entry; tests drive promotion with the fake clock.
- **AI** — Spec §14 (R14–R18) written; a compact Phase 7 task list appended to the plan instead
  of a full-code plan, since the work is executed in the same session immediately after.
- **AI** — Domain (`4a54a38`): `waitlist.ts` (entry, five states, `offerTo`, `settle`,
  `leaveWaitlist`, `holdsPlace`), `releaseAt`/`isReleased` on products, `stockCounts` gains
  `released` and `waiting`, three failure codes. 11 new tests seen red first; 9 existing
  full-shape view expectations gained the two new fields.
- **AI** — Store + service (`281d641`): waiting-list storage (a `Map` keeps queue order on update),
  `joinWaitlist`, `leaveWaitlist`, `setReleaseAt`, `processWaitlists`, `#promote` inside the lock
  after every write, `reserve` gated by `NOT_RELEASED` / `WAITLIST_ACTIVE`, positions computed at
  snapshot time. 26 new tests (R14–R18 incl. 500 concurrent joins) — **all passed on the first
  run**; one lint error (`_previous` unused) fixed by building the base product explicitly.
- **AI** — HTTP + sweeper (`a1e566b`): `releaseAt` on create and PATCH (`parseUpdateProduct`, at
  least one field, `null` clears), join and leave routes, `SWEEP_INTERVAL_MS = 1000` in
  `startServer` cleared on close; 17 new tests including a real-time smoke (release 1 s away →
  offered without anyone acting).
- **AI** — Page (`912ae71`): "On sale at" with a "+30 s" helper, countdown to release on rows, a
  Waiting column, a Waiting lists section, Join waiting list / Leave / `your turn` / `missed your
  turn` on cards, × also leaves any lines. Browser run with stock 1, hold 8 s, release +30 s, three
  joins: offered → missed → offered → missed → offered → missed, each within a second of the
  moment, then ordinary "Add to cart" again. No console errors.
- **AI** — Phase 7 result: 183 tests in 16 files passing; ESLint, `tsc --noEmit` and Prettier
  clean; coverage 96.5% lines, 91.4% branches, 97.4% functions. README (waiting lists section,
  routes, codes), ADR 0004, walkthrough, DEFENCE-B (Q22–24), spec §14 and this journal updated.
- **NOTE** — Branch coverage dipped from 93.8% to 91.4%: the new branches are the guard paths for
  `releaseAt` (string vs null vs absent) and the settle switch; each is exercised by at least one
  test, the uncovered ones are the `undefined`-hold defensive branches in `#promote` and
  `leaveWaitlist`. Recorded, not chased.
