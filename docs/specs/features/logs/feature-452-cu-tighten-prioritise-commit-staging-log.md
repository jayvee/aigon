# Implementation Log: Feature 452 - tighten-prioritise-commit-staging
Agent: cu

## Status

**Done.** `lib/git-staging.js` exposes `stagePaths` and **`stageAndCommitPaths`** (`git commit -m … -- <paths>`) so unrelated pre-staged index entries are not scooped into chore commits. **`refreshFeatureDependencyGraphs`** returns **`updatedPaths`**. Precision staging wired at `entityPrioritise`, `feature-unprioritise`, `research-unprioritise`, `feature-now`, `feature-start` (moved-from-backlog), **`entityDelete`**; `feature-close` imports `stagePaths` from `git-staging`. Integration coverage: `tests/integration/prioritise-commit-isolation.test.js`.

**Validation:** `npm run test:iterate` passed (2026-04-29).

## New API Surface

- `lib/git-staging.js`: `stagePaths`, `stageAndCommitPaths`
- `refreshFeatureDependencyGraphs` return value includes `updatedPaths`

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

- `tests/integration/prioritise-commit-isolation.test.js` — REGRESSION F452: prioritise (untracked + pre-staged deletion), research-prioritise mirror, `feature-now` stranger isolation.

## Planning Context

### ~/.claude/plans/woolly-stirring-waterfall.md

# Plan: tighten-prioritise-commit-staging

## Context

When `aigon feature-prioritise <name>` runs, it auto-commits the move from `01-inbox/` to `02-backlog/`. The commit logic in `lib/entity.js:476` does:

```js
runGit(`git add ${def.paths.root.replace(process.cwd() + '/', '')}/`);
runGit(`git commit -m "chore: prioritise ${def.type} ${paddedId} - move to backlog"`);
```

That `git add docs/specs/features/` is a directory-level stage — it sweeps **every** dirty file in that subtree (including unrelated untracked specs and pre-staged deletions) into the auto-commit.

We just hit it on F451: the prioritise commit was supposed to contain only F451's move, but `4c28ec4d` actually included an unrelated untracked spec (`feature-agent-telemetry-token-capture-parity.md`) and a leftover staged deletion (`feature-fix-review-to-revision-handoff-...md`). Git history is now misleading — anyone reading "chore: prioritise feature 451" wouldn't expect to find an unrelated spec creation in the same commit.

The same broad-stage anti-pattern lives at five sites and affects both feature and research workflows. The fix is mechanical: a working precise-stage helper (`stagePaths`) already exists in the codebase and is used correctly by `feature-close`. This feature replaces the broad-stage with precise staging at every site.

The intended outcome: every aigon auto-commit includes **only** the files the command actually touched. Unrelated dirty/untracked files in spec directories remain unaffected and visible to the user as plain `git status` output, exactly as they would after any other targeted edit.

## Scope (sites to fix)

Five auto-commit sites use the broad-stage pattern. All five must be converted.

| # | Site | Affected command(s) | Currently stages |
|---|------|---------------------|------------------|
| 1 | `lib/entity.js:475-481` | `feature-prioritise`, `research-prioritise` (both go through `entityPrioritise`) | `${def.paths.root}/` |
| 2 | `lib/commands/feature.js:711-712` | `feature-unprioritise` | `docs/specs/features/` |
| 3 | `lib/commands/feature.js:797-804` | `feature-now` (create + start) | `docs/specs/features/` |
| 4 | `lib/commands/research.js:172` | `research-unprioritise` | `docs/specs/research/` |
| 5 | `lib/feature-start.js:413` | `feature-start` (only when `movedFromBacklog`) | `docs/specs/features/` |

The model pattern already in the codebase is `lib/feature-close.js:864-912` (`commitSpecMove`): build an explicit `stagedPaths` array, then call `stagePaths(runGit, repoPath, stagedPaths)`. Replicate that everywhere.

## Approach

### Step 1 — Move `stagePaths` to a shared module

`stagePaths` currently lives at `lib/commands/feature.js:119-124`. Today it's accessible from `feature.js` and via `ctx.utils` to `feature-close.js`. To use it from `lib/entity.js`, `lib/commands/research.js`, and `lib/feature-start.js`, move it to a small shared module:

- **New file:** `lib/git-staging.js` (~30 LOC).
- **Exports:** `stagePaths(runGit, repoPath, paths)`. Identical body to today.
- **Import sites:** `lib/entity.js`, `lib/commands/feature.js`, `lib/commands/research.js`, `lib/feature-start.js`, `lib/feature-close.js`.
- Keep the parameter shape `(runGit, repoPath, paths)` so existing call sites in `feature-close.js` work unchanged.
- Delete the now-duplicated definition at `lib/commands/feature.js:119`.

### Step 2 — Make `refreshFeatureDependencyGraphs` return modified paths

Today it returns `{ changedSpecs, updatedIds }` (a count + array of IDs). The graph writer (`upsertDependencyGraphSection` at `lib/feature-dependencies.js`) modifies specific spec files but doesn't surface those paths.

Change `refreshFeatureDependencyGraphs` (`lib/feature-dependencies.js:551`) to additively return `updatedPaths`:

```js
return { changedSpecs, updatedIds, updatedPaths };
```

`updatedPaths` is the list of full filesystem paths that `upsertDependencyGraphSection` actually rewrote. This requires either:
- (preferred) Have `upsertDependencyGraphSection` return a boolean (it already does — `if (upsertDependencyGraphSection(entry.fullPath, svg))`), and push `entry.fullPath` into `updatedPaths` in the same branch where `updatedIds` is pushed. Pure additive, ~3 LOC.
- (fallback) Compute paths from IDs at the call site by re-resolving each ID through `findFile` — duplicative, skip.

Backward-compatible: callers that ignore `updatedPaths` (currently all of them) keep working. The three callers (`lib/entity.js:468`, `lib/feature-close.js:849`, `lib/feature-start.js:401`) start consuming it as part of this fix.

### Step 3 — Convert each site to precise staging

For each of the five sites, identify the exact files mutated and pass them to `stagePaths`:

#### 3a. `lib/entity.js:475-481` (`entityPrioritise`)

Files actually touched:
- The moved spec at its **new** path: `moved.fullPath` (already known — line 459).
- The moved spec's **old** path: tracked git rename. `git add -- <newPath>` is sufficient because git detects the rename when the old path no longer exists. (Confirmed against `git mv` semantics — staging only the destination after `fs.renameSync` records as a rename in the commit.)
- Spec frontmatter rewrite by `rewriteDependsOn` (line 463) — same `moved.fullPath`, no new file.
- Dependency graph updates from `refreshFeatureDependencyGraphs` (line 468) — these edit **other** specs. After Step 2, we have `updatedPaths`.

New code shape:
```js
const stagedPaths = [moved.fullPath];
if (def.type === 'feature') {
    const graphResult = refreshFeatureDependencyGraphs(def.paths, cliParseLib);
    if (graphResult.changedSpecs > 0) {
        console.log(`🕸️  Updated dependency graphs in ${graphResult.changedSpecs} feature spec(s)`);
        stagedPaths.push(...graphResult.updatedPaths);
    }
}
try {
    stagePaths(runGit, process.cwd(), stagedPaths);
    runGit(`git commit -m "chore: prioritise ${def.type} ${paddedId} - move to backlog"`);
    console.log(`📝 Committed ${def.type} prioritisation`);
} catch (e) {
    console.warn(`⚠️  Could not commit: ${e.message}`);
}
```

#### 3b. `lib/commands/feature.js:711-712` (`feature-unprioritise`)

Touched: just the un-prioritised spec moved back to inbox. Stage that one path. No dep-graph refresh in this flow (verified — graph regen is only on prioritise/start/close).

#### 3c. `lib/commands/feature.js:797-804` (`feature-now`)

Touched (in the order they happen earlier in the function):
- The spec file at its destination (`03-in-progress/`).
- The implementation log if `writeNowLog === true` and it was newly created (lines 788-795 — track the path locally as `logCreatedPath` only when `fs.existsSync(logPath)` was false at write time).
- Dependency graph updates if `refreshFeatureDependencyGraphs` ran (currently it does — feature-now is a feature flow). Feed `updatedPaths` from Step 2.

#### 3d. `lib/commands/research.js:172` (`research-unprioritise`)

Mirror of 3b. Stage just the one moved spec path. No graph regen for research.

#### 3e. `lib/feature-start.js:413` (`feature-start` `movedFromBacklog` branch)

Touched:
- The moved spec (backlog → in-progress).
- Implementation log if newly created.
- Dependency graph updates (line 401 already calls `refreshFeatureDependencyGraphs`).

### Step 4 — Tests

No existing test asserts staging content (verified — `tests/integration/prioritise-dep-validate.test.js` only checks exit codes and folder positions). Add one focused integration test:

- **New test:** `tests/integration/prioritise-commit-isolation.test.js`
- **Setup:** init a temp git repo, scaffold an aigon project (use existing test helpers from `tests/_helpers.js`).
- **Test 1:** Create a spec in `01-inbox`. Create a second untracked file `01-inbox/feature-stranger.md`. Run `aigon feature-prioritise <slug-of-first>`. Assert:
  - The prioritise commit (`HEAD`) contains the moved spec only — `git show --stat HEAD` does not list `feature-stranger.md`.
  - `feature-stranger.md` is still untracked after the commit (`git status --porcelain` shows `??`).
- **Test 2:** Same setup but pre-stage an unrelated deletion (`git rm --cached`) before prioritise. Assert the staged deletion is **not** in the prioritise commit and remains staged afterward.
- **Test 3:** Mirror of Test 1 for `research-prioritise` (cover the entityPrioritise shared path with both entity types).
- **Test 4:** `feature-now` smoke — create a stranger file, run feature-now, assert the commit has only the spec + log + (graph updates if any), not the stranger.

Skip explicit tests for `feature-unprioritise`, `research-unprioritise`, and `feature-start` movedFromBacklog — they share the same `stagePaths` pattern; one site with a regression test gives confidence in the others. Add the budget if reviewers ask.

### Step 5 — Defense-in-depth comment

At each precise-stage call site, add a one-line comment:

```js
// Stage only files this command produced. If you add another file-writing step above,
// append its path to stagedPaths — directory-level git add is not allowed (sweeps unrelated changes).
```

This is the only comment we'll add. Future bugs of this shape are then a code-review catch.

## Out of scope

- The setup/doctor migration commits at `lib/commands/setup.js:2816,2826`. Those are one-time migrations where sweeping the migration target dir is intentional.
- `lib/feature-close.js:875,903` — already mitigated with `git reset --quiet HEAD --` followed by `stagePaths`. Leave alone (works correctly).
- `git status --porcelain` post-commit assertion. Adds complexity for limited additional safety once tests exist; revisit only if a regression slips past the tests.

## Critical files to modify

- `lib/git-staging.js` — **new**, exports `stagePaths`.
- `lib/feature-dependencies.js:551-575` — additively return `updatedPaths` from `refreshFeatureDependencyGraphs`.
- `lib/entity.js:463-481` — convert prioritise commit to `stagePaths`. Import from `lib/git-staging.js`.
- `lib/commands/feature.js:119-124` — delete duplicated `stagePaths`. Import from `lib/git-staging.js`.
- `lib/commands/feature.js:707-712` — convert `feature-unprioritise` commit to `stagePaths`.
- `lib/commands/feature.js:780-804` — convert `feature-now` commit to `stagePaths`. Track newly-created log path.
- `lib/commands/research.js:160-180` — convert `research-unprioritise` commit to `stagePaths`.
- `lib/feature-start.js:395-420` — convert `feature-start` movedFromBacklog commit to `stagePaths`.
- `lib/feature-close.js` — update import of `stagePaths` to come from new `lib/git-staging.js` (drop `ctx.utils.stagePaths` plumbing or keep for back-compat — pick one in implementation).
- `tests/integration/prioritio-commit-isolation.test.js` — **new**, four-test file.

## Existing functions/utilities to reuse (do not reinvent)

- `stagePaths(runGit, repoPath, paths)` — `lib/commands/feature.js:119` (moving to `lib/git-staging.js`).
- Reset+stage pattern from `commitSpecMove` — `lib/feature-close.js:864-912`. Best-practice example to mirror.
- `runGit` — already wired in every target file via the shared ctx pattern. Don't add another.
- `path.relative(repoPath, p)` quoting via `JSON.stringify` — already inside `stagePaths`. Don't reimplement.
- Test helpers `withTempDir`, `withTempDirAsync`, `report` — `tests/_helpers.js`. Used by neighboring integration tests.

## Verification

1. **Unit/integration tests pass:**
   ```bash
   npm test
   ```
   New file `tests/integration/prioritise-commit-isolation.test.js` should run as part of `npm test` (the runner discovers `tests/integration/*.test.js` automatically — verified via existing files there).

2. **Manual reproduction of the original bug, confirmed fixed:**
   ```bash
   # On a fresh worktree:
   echo "# stranger" > docs/specs/features/01-inbox/feature-untracked-stranger.md
   aigon feature-create demo-fix-verification
   aigon feature-prioritise demo-fix-verification
   git show --stat HEAD   # should list ONLY the moved spec — no stranger file
   git status              # should show feature-untracked-stranger.md still untracked (??)
   # Cleanup:
   rm docs/specs/features/01-inbox/feature-untracked-stranger.md
   aigon feature-unprioritise <demo-id>  # then manually delete spec
   ```

3. **Pre-push gate:**
   ```bash
   npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh
   ```

4. **Spot-check rename detection in commit:**
   ```bash
   # After a real prioritise:
   git log -1 --stat --find-renames
   # Should show the spec as a rename (R) from 01-inbox to 02-backlog, not delete+add.
   ```
   This validates that staging only the destination path still records a rename — important for git history readability.

## Risks and mitigations

- **Worktree path mismatch.** When prioritise runs from a worktree, `process.cwd()` is the worktree, but spec moves happen via `mapPathToCurrentCheckout`. `stagePaths` already does `path.relative(repoPath, p)`, so as long as we pass the same `repoPath` that `runGit` uses (i.e., `process.cwd()` for the current shell), staging is correct. Verify in test 4 if a worktree-mode test fits.
- **Pre-commit hooks expecting broad staging.** A hook that scans `git diff --cached` would now see fewer files. That's the intended outcome, but flag it in the implementation log as a behavioral change for users with custom hooks.
- **Stage-list drift.** Future code that adds a file-write step inside one of these flows could forget to update `stagedPaths`. Mitigations: (a) the inline comment from Step 5; (b) the regression test from Step 4 will catch any "stranger file ends up in commit" regression. We chose not to add a `git status --porcelain` post-commit guard — the test coverage is sufficient and the guard would be noisy in legitimate workflows.
- **`feature-now` log-file edge case.** The current code creates the log only if `!fs.existsSync(logPath)`. After Step 3c, we must capture whether the log was actually written (not just whether the path exists) so we don't stage someone's pre-existing log file. Solution: a local `logCreatedPath` that is set only inside the `if (!fs.existsSync(logPath))` branch.
- **`stagePaths` empty-list handling.** Already handled (`if (uniquePaths.length === 0) return;`). The follow-up `git commit` would fail with "nothing to commit" — but every site here always has at least the moved spec, so this can't happen in practice.

## Complexity rating

**Medium.** Five small, well-scoped sites; one new module; one additive return-shape change; one new test file. No engine-state changes, no XState transitions, no template-engine cross-cutting. The risk surface is contained to git auto-commit behavior on five commands, all already covered by spec lifecycle in the test suite.
