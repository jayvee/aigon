---
complexity: medium
---

# Feature: getNextId collision when recurring tasks run inside a feature worktree

## Summary

`getNextId` (in `lib/spec-crud.js`) scans only the filesystem of its working directory to find the highest feature ID. When recurring tasks run inside a feature worktree that was branched from main before new IDs were assigned on main, the worktree's filesystem doesn't see those newer IDs — so `getNextId` returns IDs already taken on main. After the worktree merges, both specs share the same ID, breaking spec resolution everywhere.

Witnessed in the wild: F356 worktree ran all four weekly recurring tasks and assigned IDs 359–362; main had independently assigned 359 and 360 to different features. Post-merge, two pairs of duplicate IDs existed and required manual renaming to fix.

The fix has two parts: (1) block recurring task execution inside a worktree — recurring tasks belong to the main repo and should never run from a worktree CWD; (2) harden `getNextId` with a git-based scan of the main branch as a fallback so the same class of collision can't occur via other paths.

## Acceptance Criteria

- [ ] Running `aigon` recurring check from inside a feature worktree does not create any feature specs or assign any IDs; it prints a clear message and exits 0
- [ ] `getNextId` returns an ID higher than any ID present on the git main branch, not just the worktree filesystem
- [ ] If the main branch cannot be resolved (detached HEAD, no `main`/`master`), `getNextId` falls back to filesystem-only scan with a warning
- [ ] No existing tests broken; new unit test covers worktree-aware ID assignment
- [ ] `npm test` passes

## Technical Approach

**Part 1 — Block recurring from worktrees (`lib/recurring.js`)**

Detect worktree context at the start of `runRecurringCheck`:
```bash
git rev-parse --git-common-dir  # differs from --git-dir when inside a worktree
git rev-parse --git-dir
```
If they differ, log `[recurring] Skipping: running inside a feature worktree. Recurring tasks run from the main repo only.` and return early. This is cheap, has no false positives, and directly prevents the bug.

**Part 2 — Harden `getNextId` (`lib/spec-crud.js`)**

After scanning the filesystem for `maxId`, also run:
```bash
git ls-tree -r --name-only main -- docs/specs/features/
```
(and `master` as fallback if `main` doesn't exist). Parse the filenames from git output with the same regex to find the git-side `maxId`. Return `max(filesystemMax, gitMax) + 1`. Wrap in a try/catch so any git failure (no git, detached, bare repo) silently falls back to the current filesystem-only behaviour.

The git call is synchronous (`execFileSync`) — `getNextId` is already called in a sync context in `recurring.js` and `lib/commands/feature.js`.

## Validation

```bash
node -e "const s = require('./lib/spec-crud'); console.log(typeof s.getNextId)"
npm test
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +20 LOC for the new unit test.

## Out of Scope

- Fixing the duplicate IDs that already exist in the repo (done manually as part of the incident)
- A general-purpose distributed ID counter or lock file — the git scan is sufficient given single-operator usage
- Detecting worktree context for commands other than recurring

## Related

- Set:
