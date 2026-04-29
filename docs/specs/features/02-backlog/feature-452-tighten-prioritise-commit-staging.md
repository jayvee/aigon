---
complexity: medium
planning_context: ~/.claude/plans/woolly-stirring-waterfall.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T10:23:04.145Z", actor: "cli/feature-prioritise" }
---

# Feature: tighten-prioritise-commit-staging

## Summary

Several aigon auto-commits use directory-level `git add docs/specs/features/` (or `…/research/`) instead of staging only the files the command actually touched. This sweeps up unrelated dirty/untracked files that happen to live under the same spec tree, producing misleading commit history. We just hit it on F451 — the prioritise commit silently bundled an unrelated untracked spec and a leftover staged deletion.

This feature replaces the broad-stage anti-pattern at all five known sites with precise staging via the existing `stagePaths` helper (already used correctly by `feature-close`). After the fix, every aigon auto-commit contains only the files it produced; unrelated files in spec directories stay visible to the user as plain `git status` output.

## User Stories

- [ ] As an operator, when I run `aigon feature-prioritise <name>`, I want the resulting commit to contain only the prioritised spec — not unrelated specs I happened to leave dirty in `01-inbox/`.
- [ ] As a future reader of `git log`, I want a commit titled `chore: prioritise feature 451 - move to backlog` to actually be that change and nothing else.
- [ ] As a maintainer adding a new file-writing step to one of these flows, I want a clear pattern (and a regression test) that fails loud if I forget to add the new path to the stage list.

## Acceptance Criteria

- [ ] `lib/git-staging.js` exists and exports `stagePaths(runGit, repoPath, paths)` with identical body to today's helper at `lib/commands/feature.js:119-124`. The duplicate definition in `feature.js` is deleted; `feature.js` imports from the new module.
- [ ] `lib/feature-dependencies.js` `refreshFeatureDependencyGraphs` additively returns `updatedPaths: string[]` alongside the existing `changedSpecs` and `updatedIds`. Existing callers that ignore it keep working.
- [ ] `lib/entity.js entityPrioritise` (covering both `feature-prioritise` and `research-prioritise`) stages only the moved spec path plus any `updatedPaths` from the dependency-graph refresh. The broad `git add ${def.paths.root}/` is removed.
- [ ] `lib/commands/feature.js feature-unprioritise` stages only the un-prioritised spec path. The broad `git add` is removed.
- [ ] `lib/commands/feature.js feature-now` stages only: the spec destination path, the implementation log if it was newly created in this run, and any `updatedPaths` from dependency-graph refresh. The broad `git add` is removed.
- [ ] `lib/commands/research.js research-unprioritise` stages only the moved spec path. The broad `git add` is removed.
- [ ] `lib/feature-start.js` (the `movedFromBacklog` branch) stages only: the moved spec, the implementation log if newly created, and any `updatedPaths`. The broad `git add` is removed.
- [ ] Each of the five converted sites carries a one-line comment explaining that directory-level `git add` is not allowed and stage-list must be updated when new file-writing steps are added.
- [ ] New integration test `tests/integration/prioritise-commit-isolation.test.js` covers four cases:
    1. `feature-prioritise` with an unrelated untracked file in `01-inbox/` — stranger file is NOT in the commit and remains untracked after.
    2. `feature-prioritise` with a pre-staged unrelated deletion — deletion is NOT in the commit and remains staged after.
    3. `research-prioritise` mirror of case 1 (proves the shared `entityPrioritise` path works for both entity types).
    4. `feature-now` with a stranger file — stranger is NOT in the commit.
- [ ] After a real prioritise, `git log -1 --stat --find-renames HEAD` shows the spec move as a rename (`R`) rather than delete+add — confirming staging only the destination still records a rename correctly.
- [ ] Pre-push gate passes: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.

## Validation

```bash
node --check aigon-cli.js
node tests/integration/prioritise-commit-isolation.test.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

See `~/.claude/plans/woolly-stirring-waterfall.md` for the full implementation plan, including the per-site code sketches and verification matrix. High-level:

1. Extract `stagePaths` from `lib/commands/feature.js` into a new shared `lib/git-staging.js`, so it can be imported from `entity.js`, `commands/research.js`, `feature-start.js`, and `feature-close.js`.
2. Make `refreshFeatureDependencyGraphs` (`lib/feature-dependencies.js:551`) additively return `updatedPaths` — the full filesystem paths of every spec whose dep-graph section was rewritten. Pure additive change — three lines in the existing loop, no caller breakage.
3. Convert each of the five sites to build an explicit `stagedPaths` array and call `stagePaths(runGit, process.cwd(), stagedPaths)` instead of broad `git add <dir>/`. Per-site path lists:
    - `entityPrioritise` → `[moved.fullPath, ...graphResult.updatedPaths]`
    - `feature-unprioritise` → `[movedSpecPath]`
    - `feature-now` → `[specDestPath, logCreatedPath?, ...graphUpdatedPaths]`
    - `research-unprioritise` → `[movedSpecPath]`
    - `feature-start` (movedFromBacklog) → `[movedSpecPath, logCreatedPath?, ...graphUpdatedPaths]`
4. For `feature-now`, track a local `logCreatedPath` set only inside the `if (!fs.existsSync(logPath))` branch so we don't stage a pre-existing log file the user owns.
5. Mirror the model already used by `lib/feature-close.js:864-912` (`commitSpecMove`) — it builds an explicit `stagedPaths` array and calls `stagePaths`. We're applying the same pattern at the remaining sites.

The reset-then-stage pattern from `feature-close.js` (`git reset --quiet HEAD --` before staging) is **not** required at these sites: precise `git add -- <path>` only stages the listed paths, so leftover staged-elsewhere files are unaffected. Adding a reset would actually cause harm — it would unstage the user's deliberate pre-staged edits.

Worktree path concern: `stagePaths` already calls `path.relative(repoPath, p)` and `runGit` runs in the current cwd, so as long as we pass `process.cwd()` consistently, worktree mode works. The new test should include a worktree variant if scaffolding fits within the test helpers; otherwise documented as a known-good follow-up check.

## Dependencies

-

## Out of Scope

- **`lib/commands/setup.js:2816,2826` doctor migration commits.** One-time migrations where sweeping the migration target dir is intentional. Different problem shape.
- **`lib/feature-close.js:875,903` close commits.** Already mitigated with `git reset --quiet HEAD --` followed by `stagePaths`. Working correctly — no change needed.
- **Post-commit `git status --porcelain` guard.** Considered as defense-in-depth but rejected: the regression test is sufficient and the guard would noise on legitimate workflows where the user has unrelated dirty files outside the spec dir.
- **Reformatting existing commits in history.** F451's already-merged commit `4c28ec4d` stays as is; this fix prevents recurrence, not retroactive cleanup.
- **Changing the commit-message format or adding co-author footers.** Not the scope here.
- **Auditing other commit sites in the codebase outside the five identified.** The Explore phase confirmed there are no other `git add <dir>/`-pattern auto-commits in the workflow paths. If new ones appear later, this feature establishes the precedent and helper for fixing them.

## Open Questions

- Should the `lib/feature-close.js` import of `stagePaths` switch to the new `lib/git-staging.js` module, or keep the existing `ctx.utils.stagePaths` plumbing? Both work; implementer picks based on which leaves a cleaner call site. Default: import directly from the new module to remove one layer of indirection.
- Worktree-mode coverage in the new test file: scaffold a `git worktree add` and run the prioritise from there, or rely on existing worktree integration tests to catch staging regressions transitively? Default: document as deferred follow-up if scaffolding adds >50 LOC; otherwise include.

## Related
- Set:
- Prior features in set:
