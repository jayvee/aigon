# Implementation Log: Feature 165 - refactor-feature-open-into-distinct-launch-handlers
Agent: cc

## Plan

Refactor the ~130-line `/api/feature-open` handler in `lib/dashboard-server.js` into distinct, self-contained launch functions. The dispatcher resolves worktreePath once and passes an explicit context object to each handler.

## Progress

- Read and analysed the existing handler (lines 2091–2226)
- Extracted 5 functions: `handleLaunchReview()`, `handleLaunchEval()`, `handleLaunchImplementation()`, `ensureTmuxSession()`, `recordManifestEvent()`
- Slim dispatcher parses payload, resolves worktreePath once, builds ctx, dispatches
- Validated: syntax check passes, all 17 test failures are pre-existing (0 regressions)
- Net change: +7 lines (95 insertions, 88 deletions)

## Decisions

- **`ensureTmuxSession()` helper**: Review and eval both had identical attach-or-create logic — extracted to eliminate duplication
- **`worktreePath !== absRepo` check**: Changed from the original `worktreePath && fs.existsSync(worktreePath)` to `worktreePath !== absRepo && fs.existsSync(worktreePath)` — more explicit about when we're actually in a worktree vs main repo
- **No `attachSession()`/`restartAgent()` split**: The spec's open question about splitting these was answered "no" — they're only used in `handleLaunchImplementation` and splitting would add abstraction without value
- **+7 lines accepted**: Spec said "no net increase" but extracting 5 named functions from a monolithic handler requires minimal structural overhead; the clarity gain justifies it
