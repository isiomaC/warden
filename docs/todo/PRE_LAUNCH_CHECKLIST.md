# Pre-Launch Checklist (tracked working copy)

> This is a tracked (non-gitignored) copy of the checklist kept in
> `docs/internal/NPM_PUBLISHING.md` § "Pre-Launch / Release Checklist", so it survives even
> though `docs/internal/` itself is gitignored and local-only. Update both when either
> changes, or consolidate later once the two files' purposes are settled.

## Open items

- [ ] **Verify the `@warden` npm scope is actually available.** "Warden" is a common name;
  run `npm view @warden/core` (and the other 4 package names) against the real npmjs.org
  registry before publishing. If any are taken, every `package.json` in this monorepo needs
  a scope swap (e.g. `@warden-agent`, `@agentwarden`) — this touches `name`, all
  `dependencies`/`peerDependencies` entries referencing `@warden/*`, the `bin` entry, CI
  workflows, and every doc that mentions the package names. Do this check first since it's
  the most disruptive to discover late.
- [ ] **Decide version-bump timing.** All 5 packages are still at `0.1.0`. No decision has
  been made on when to cut the first real release vs. continuing to iterate pre-release.
- [ ] **Merge the docs-reorg branch into `main` before making the repo public** (or before
  telling anyone the repo is public). `claude/warden-review-testing-ray45t` has the fix that
  separates internal/maintainer docs (`docs/internal/*`, former `AGENTS.md`) from what
  npm/git actually ships — but as of this writing `main` (and `origin/main`) have **not**
  merged that branch yet and still have `docs/internal/` tracked in their history. Until this
  merges, `main` still ships the internal docs to anyone who clones/browses it. This is the
  single most important item on this list.
- [ ] **Decide whether to also rewrite `main`'s git history** to purge `docs/internal/*` from
  past commits, not just untrack it going forward (git history preserves the old file
  contents in old commits regardless of the untrack). This requires `git-filter-repo` (not
  installed in the review environment — needs `pip install git-filter-repo`) and a
  force-push to `main` on the shared origin remote, which invalidates any other
  clones/forks — treat as a deliberate, separately-confirmed action, not a routine one.
  If skipped, the untrack-going-forward fix is still sufficient to stop *future* exposure.

## Status as of this writing

- `npx tsc --noEmit` — clean
- `npx vitest run` — 327 passed, 3 skipped
- Branch `claude/warden-review-testing-ray45t` has all launch-hardening, docs-reorg, and
  changelog work; not yet merged to `main`
