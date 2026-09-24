# ADR 0005 — Versions come from the conventional commits, released locally after each merged PR

**Status:** accepted, 2026-09-24

## Context

Every change now arrives as a pull request, and each merged one should be a release: a semver
bump, a changelog entry, a GitHub Release page, and a running server that can say which release
it is. The commits are already conventional (a `commit-msg` hook enforces it), so the information
that decides a bump is already in the history. One person works on the repository and pushes and
merges by hand; the AI tooling never pushes.

## Decision

`npm run release` runs `commit-and-tag-version` locally on `main` after a merge. It reads the
commits since the previous tag, bumps `package.json` (`feat` → minor, `fix`/`perf` → patch,
`!`/`BREAKING CHANGE` → major), rewrites `CHANGELOG.md` as `.versionrc.json` says (Features, Bug
Fixes, Performance and Build and CI shown; docs, chore, test and refactor hidden), commits
`chore(release): X.Y.Z` through the normal hooks and tags `vX.Y.Z`. Pushing with `--follow-tags`
triggers `release.yml`, which creates the GitHub Release with that version's changelog section
(`scripts/release-notes.ts`) and fails rather than publish empty notes. The first release tags the
existing `1.0.0` without a bump (`--first-release`). `GET /api/health` reports the version, inlined
from `package.json` at build time.

Rejected: release-please (a bot opens a release PR per merge; needs the "Actions may create pull
requests" repository setting and a second merge per release); semantic-release (releases from CI
on every push to `main`, cannot start below 1.0.0, does not commit the bump by default);
`gh release create --generate-notes` (notes from PR titles: a second source of truth beside the
changelog); a version and changelog edited by hand.

## Consequences

- The bump is decided by commit types, so a PR's commits must be typed honestly. A PR of only
  `docs` or `chore` commits still produces a patch release; that is the tool's rule.
- Merges must keep the individual commits (merge commit or rebase, not squash), or the changelog
  sees one line per PR.
- The release commit runs the full pre-commit sweep like any other. `CHANGELOG.md` is generated
  and never edited by hand.
- One manual step per merge (`npm run release && git push --follow-tags`). Moving it into CI is a
  small change once a team and the repository settings call for it.
