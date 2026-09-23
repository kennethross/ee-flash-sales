# Before you submit — things only Kenneth can do

The code, tests, README, ADRs and records are complete. These remain, in order of importance.

## 0. Decide A or B (deadline 2026-09-23)
- [ ] Submitted on 2026-09-23 (journal). This folder continues as your own project: 183 tests,
      HTTP API + simulator page with cart, reset, an audit trail and coming-soon waiting lists.
- [ ] Ask yourself which you can defend better cold. The AI's view (recorded in the journal on
      2026-09-21): A is the safer submission; B has the better interview story on concurrency.

## 1. Make it yours (study)
- [ ] Read `docs/working/WALKTHROUGH.md` with the code open, in the order it gives.
- [ ] Run `npm start`, open the page, break it: everyone adds to cart, checkout, remove a line,
      5-second hold time, remove a customer with a hold, remove a product with active holds,
      reset, two tabs; watch the Activity list while you do it.
- [ ] Take `/grill-me` sessions on: the mutex line by line · why a Map needs a lock · the no-lock
      test · two instances · expiry on read · reload inside the lock · the audit trail · the
      waiting list's `#promote` and the sweeper · the AI questions.
- [ ] Rewrite every answer in `docs/DEFENCE-B.md` in your own words. Answer 25 and 26 yourself.

## 2. Make the README true
Every sentence in "AI disclosure" must be true *of you*:
- [ ] "I approved each section" — you did, in conversation; read the spec once to be sure you agree.
- [ ] "I reviewed and approved the assumptions above" — read the eight and agree, or change them.
- [ ] "I … can walk through any file" — only after step 1.
- [ ] Edit anything that does not sound like you. Do **not** soften the AI disclosure.

## 3. Commit history
- [ ] Skim `git log`. Commit bodies are one line each; reword any subject you would not say
      (`git rebase -i` while the repo is still local), or leave them.
- [ ] Author name is `k5hr2s`. If reviewers should see your real name:
      `git config user.name "Your Name"` then
      `git rebase -r --root --exec 'git commit --amend --no-edit --reset-author'`
      (local history only — never after pushing). The pre-commit hook runs on each replayed commit.

## 4. Decide what ships
- [ ] `docs/MISSION.md`, `docs/working/`, `docs/superpowers/`, `docs/DEFENCE-B.md` are internal.
      They live in `docs(internal):` commits so they can be dropped before the first push.
      Shipping `JOURNAL.md` backs up the AI disclosure; `DEFENCE-B.md` probably should **not** ship.
      If you drop the journal, remove the last line of the README's AI disclosure.
- [ ] `docs/adr/` ships (it is in a `docs:` commit with the README).

## 5. Submit
- [ ] Choose: private GitHub repo + invite the reviewer (recommended), public repo, or ZIP (zip the
      folder including `.git`, without `node_modules` and `coverage`).
- [ ] Fresh-clone check passes (done once by the AI on 2026-09-22; repeat after any history rewrite):
      `git clone <repo> fresh && cd fresh && npm ci && npm run format:check && npm run lint && npm run typecheck && npm test && npm start`
- [ ] After pushing: confirm the GitHub Actions run is green on Node 22 and 24.
