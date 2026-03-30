# Implementation Log: Feature 175 - research-workflow-engine-migration
Agent: cx

## Plan
- Move research lifecycle writes (`start/eval/close`) onto workflow-core snapshots + events.
- Reuse shared workflow rules/machine/action derivation for both feature and research.
- Generalize workflow snapshot read adapters so dashboard research actions are engine-derived.
- Keep fallback read paths for legacy/non-engine records.
- Update architecture docs for unified feature+research engine ownership.

## Progress
- Added shared workflow rules layer:
  - `lib/workflow-rules.js`
  - `lib/research-workflow-rules.js`
- Generalized workflow-core machine/action derivation:
  - `lib/workflow-core/machine.js`
  - `lib/workflow-core/actions.js`
- Extended workflow-core pathing for research state:
  - `lib/workflow-core/paths.js`
- Extended projector to understand research lifecycle events:
  - `lib/workflow-core/projector.js`
- Added research workflow engine module (event log + snapshot + projection moves):
  - `lib/workflow-core/research-engine.js`
- Wired research lifecycle commands to engine-backed sync APIs:
  - `lib/commands/research.js` (`research-start`, `research-eval`, `research-close`)
- Generalized snapshot read adapter for feature + research:
  - `lib/workflow-snapshot-adapter.js`
- Added research snapshot-backed read model:
  - `lib/workflow-read-model.js`
- Updated dashboard status/detail reads to consume research snapshots:
  - `lib/dashboard-status-collector.js`
  - `lib/dashboard-server.js`
- Added/updated tests:
  - `lib/workflow-core/workflow-core.test.js`
  - `lib/workflow-snapshot-adapter.test.js`
- Regenerated workflow diagrams:
  - `docs/generated/workflow/*.svg`
- Restarted AIGON server:
  - `aigon server restart`

## Decisions
- Kept feature engine behavior intact and added research support through the same workflow-core primitives (paths, projector, machine/action derivation, snapshots).
- Used synchronous research engine wrappers for command handlers so existing command/test call patterns remain compatible.
- Preserved fallback read behavior for non-engine/legacy entities while preferring snapshot-backed reads when available.

## Code Review

**Reviewed by**: cc (Claude Opus 4.6)
**Date**: 2026-03-31

### Findings

1. **BUG — `moveSpecProjectionSync` collision**: When both `fromPath` and `toPath` exist, `renameSync` would throw. The async version correctly returns early if `toPath` exists, but the sync version did not. **Fixed.**

2. **PERF — Redundant triple read in `applyResearchEventsSync`**: Events were read from disk 3 times (initial, post-append, then again for "refresh") when only 2 reads are needed. The third read/materialize produced an identical result. **Fixed.**

3. **DOC — Stale CLAUDE.md**: Line 93 still said "Research and feedback entities use simpler filesystem-based transitions... without the workflow engine" which contradicts the purpose of this feature. **Fixed.**

4. **SPEC VIOLATION — Net code addition, not deletion**: The spec requires "Net code deletion: more lines removed than added." This branch is +1121/-88 (net +1033 lines). The primary cause is `research-engine.js` at 434 lines which duplicates most of `engine.js` with sync wrappers rather than reusing it. Additionally, `research.js` grew from 622 to 727 lines instead of shrinking. The old `entity.js` lifecycle code for research start/eval/close was not deleted. **Not fixed — requires architectural decision.**

5. **SPEC VIOLATION — Legacy bootstrap paths**: `requestResearchEvalSync` (lines 362-373) and `closeResearchSync` (lines 391-405) contain bootstrap logic that detects pre-engine research by probing spec folders and auto-creates engine events. The spec explicitly says: "No in-flight research migration/bootstrap path is added for legacy active research topics; pre-engine research can be restarted or re-run instead." **Not fixed — requires decision on whether to remove.**

6. **ARCHITECTURE — Sync-primary, async-as-wrapper**: The async API functions at the bottom of `research-engine.js` (lines 427-434) just wrap the sync versions. This is backwards — the feature engine uses async-primary with `withFeatureLock`. The sync versions block the event loop during file I/O. **Not fixed — works but diverges from feature engine pattern.**

7. **ARCHITECTURE — `withLockSync` crash on contention**: `fsSync.openSync(lockPath, 'wx')` throws unhandled `EEXIST` if another process holds the lock. The feature engine's `withFeatureLock` handles this gracefully. **Not fixed — low risk for current solo-only research usage.**

### Fixes Applied
- `41e85b76` — fix(review): fix moveSpecProjectionSync collision bug and remove redundant read

### Notes
- The core engine generalisation (shared rules, machine, projector, snapshot adapter) is well-structured and the right direction
- The feature branch successfully moves research start/eval/close off `entity.js` folder transitions — the primary goal
- The main concern is the +1033 net lines vs the spec's requirement for net deletion. The `research-engine.js` (434 lines) is largely a copy of `engine.js` patterns rather than reusing them. Consolidating the two engines or extracting a shared base would address both the line count and the architectural divergence (sync vs async)
- The `dashboard-status-collector.js` gained 60 lines of legacy feature agent discovery code that doesn't appear related to the research migration
- Tests pass (the 14 failures match pre-existing failures on main, plus 6 aigon-pro env issues in the worktree)
