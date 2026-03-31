# Implementation Log: Feature 182 - engine-cleanup-remove-legacy-bypasses
Agent: cc

## Progress

All 5 acceptance criteria completed. 11 files changed, 64 insertions, 310 deletions.

### AC1: entitySubmit emits workflow event
- Added `agent-submitted` to `SIGNAL_EVENT_MAP` in engine.js
- Added `signal.agent_submitted` handler in projector.js (sets agent status to 'ready')
- entity.js `entitySubmit()` now fire-and-forgets `emitSignal()` before the status file write
- Status file write kept as derived cache for shell traps (spec requirement)

### AC2: feature-close uses engine API
- Replaced `readEvents()` + `projectContext()` at line 1768 with `showFeatureOrNull()`
- Replaced `readEvents()` at line 2111 with `showFeatureOrNull()` — null triggers migration

### AC3: Remove dead import
- Removed `writeAgentStatusAt` import from dashboard-server.js (line 47)

### AC4: Strip state-queries.js of feature/research logic
- Removed feature/research from `ENTITY_DEFINITIONS` (feedback-only now)
- Removed `shouldNotify`, `getRecommendedActions`, `isActionValid` (no production callers)
- Dashboard-server.js: inlined all-submitted notification check using `allAgentsSubmitted`/`isFleet`
- Dashboard-server.js: `SM_INVOCABLE_ACTIONS` now built from raw constants (not ENTITY_DEFINITIONS)
- worktree.js: `classifyOrphanReason` uses terminal stage set instead of `getAvailableActions`
- Cleaned up re-exports in utils.js (removed 4) and dashboard.js (removed 4)
- Updated workflow-rules-report.js to use raw constants instead of ENTITY_DEFINITIONS lookups
- Updated tests: feature/research query tests now assert empty results

### AC5: Net line count goes down
- lib/ before: 30072, after: 30068 (-4 net)
- Commit stats: +64 / -310

## Decisions

- `entitySubmit` is synchronous but `emitSignal` is async — used fire-and-forget with `.catch()` since the status file write is the synchronous fallback
- Kept FEATURE_TRANSITIONS/RESEARCH_TRANSITIONS/FEATURE_ACTIONS/RESEARCH_ACTIONS constants in state-queries.js because generate-workflow-diagrams.js and workflow-rules-report.js reference them for documentation
- Dashboard notification logic (shouldNotify) moved inline to dashboard-server.js rather than keeping the function — simpler and avoids the entity type routing
