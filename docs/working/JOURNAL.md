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
