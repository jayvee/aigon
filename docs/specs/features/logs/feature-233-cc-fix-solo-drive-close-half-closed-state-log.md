---
commit_count: 4
lines_added: 267
lines_removed: 11
lines_changed: 278
files_touched: 6
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 125
output_tokens: 25992
cache_creation_input_tokens: 181287
cache_read_input_tokens: 10402245
thinking_tokens: 0
total_tokens: 10609649
billable_tokens: 26117
cost_usd: 20.9538
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 233 - fix-solo-drive-close-half-closed-state
Agent: cc

## Plan
Fix four interlocking bugs that left solo Drive features unable to close
cleanly and frequently in a half-closed (merged-but-not-closed) state:

1. Solo Drive launched with `agents:[]` so signals were dropped
2. `getMainRepoPath` returned the wrong directory from subdirs
3. `feature-close` ran git side-effects before validating the engine
   transition
4. No recovery path for features already broken by bug 1

## Progress
- `lib/commands/feature.js` solo Drive launch now passes `['solo']` to
  `wf.startFeature` when no explicit agent is given.
- `lib/git.js` `getMainRepoPath()` resolves a relative `git-common-dir`
  against `cwd` before `dirname`'ing — fixes the "Could not resolve
  visible spec" misroute when running aigon from any subdirectory of
  the main repo.
- `lib/workflow-core/engine.js` adds `canCloseFeature()`, a pure
  read-side helper that returns `{ ok, snapshot, reason }`. Pass-through
  states (`closing`, `done`, `evaluating`, `ready_for_review`,
  `reviewing`) return ok so the existing close path handles winner
  selection / resume logic. `applyEventsUnlocked` now re-projects via
  the projector for `feature.bootstrapped` (same path as
  `feature.started`) so the recovery event reseeds the agents map.
- `lib/feature-close.js` adds `recoverEmptyAgents()` which persists
  `feature.bootstrapped` + `agent.marked_ready` for the canonical
  `'solo'` agent when an existing snapshot has zero agents and is not
  in fleet mode. Idempotent: a snapshot with agents is returned
  untouched. `closeEngineState` calls it after refreshing the snapshot
  so legacy broken features auto-heal in-place.
- `lib/commands/feature.js` `feature-close` handler runs the
  pre-validation as Phase 3.5 — between the resume check and the
  auto-commit phase. On failure it prints a clear error and returns
  before any branch is pushed or merged.
- `tests/integration/lifecycle.test.js` gains four new tests with
  `// REGRESSION:` comments naming feature 233 / farline-ai-forge bug:
    - solo registers as `'solo'` and closes cleanly
    - `canCloseFeature` blocks pre-close when no agent has signaled
    - `recoverEmptyAgents` heals legacy `agents:[]` features
    - `getMainRepoPath` returns repo root from a subdirectory
- Test budget: 1918 / 2000 LOC.
- `npm test` lifecycle suite: 16/16 passing.
- `MOCK_DELAY=fast npm run test:ui`: 8/8 passing.
- Pre-existing pro-gate test failures (unrelated to this feature) were
  confirmed against the unmodified baseline via `git stash`.

## Decisions
- **Pre-validation as Phase 3.5, not inside `closeEngineState`.** The
  whole point is to abort BEFORE the git side-effects (auto-commit,
  push, merge) run, so the check has to live in the orchestration
  layer in `lib/commands/feature.js`. Putting it inside
  `closeEngineState` (called from Phase 7) would be too late.
- **Pass-through states in `canCloseFeature`.** Fleet mode goes through
  `evaluating` and `closeEngineState` calls `selectWinner` before
  `tryCloseFeatureWithEffects`. The pre-check validates only the bug
  we care about (stuck `implementing` with no ready agent) and lets
  the existing close path handle the rest. Without this, the fleet
  e2e test broke immediately.
- **Recovery via `feature.bootstrapped` + `agent.marked_ready`.** The
  event log is append-only, so we can't rewrite the original
  `feature.started` event. `feature.bootstrapped` is the canonical
  reseeding event in the projector and was already reserved for this
  use case. I extended `applyEventsUnlocked` to re-project on
  `feature.bootstrapped` (it previously only special-cased
  `feature.started`).
- **Single recovery call site.** I considered also calling
  `recoverEmptyAgents` from the Phase 3.5 pre-check (so the user gets
  a clean error pre-merge for legacy features), and added that — the
  pre-check now applies the same recovery the engine close phase will
  apply, so the validation reflects what the actual close will see.
- **Tests in `lifecycle.test.js`, not new files.** The 2000 LOC budget
  is at 1918; spinning up four new test files would have exceeded it.
  Lifecycle.test.js is the natural home for solo Drive close tests
  and the `getMainRepoPath` test fits in the same file because it's
  conceptually the same close-flow regression.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-07

### Findings
- No issues found.

### Fixes Applied
- None needed.

### Notes
- Reviewed the spec, implementation log, and the branch diff across `lib/commands/feature.js`, `lib/feature-close.js`, `lib/git.js`, `lib/workflow-core/engine.js`, and `tests/integration/lifecycle.test.js`.
- The implementation matches the intended narrow fix: it registers solo Drive with the canonical `solo` agent, pre-validates close before git side-effects, auto-recovers legacy empty-agent snapshots, and covers the regressions in integration tests.
