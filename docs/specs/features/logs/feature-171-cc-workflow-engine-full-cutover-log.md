# Implementation Log: Feature 171 - workflow-engine-full-cutover
Agent: cc

## Plan

Delete the legacy state machine, manifest system, and all four bridge modules. Make workflow-core the sole state system. Clean cut — no migration path, no feature flags, no backward compat.

Target: ~2,600 net lines deleted.

## Progress

### Extracted modules (preserving needed functionality)
- Created `lib/agent-status.js` — extracted agent status file I/O from manifest.js (readAgentStatus, writeAgentStatus, writeAgentStatusAt, getStateDir, getLocksDir)
- Created `lib/state-queries.js` — extracted read-only UI query functions from state-machine.js (stage definitions, transitions, actions, guards)

### Rewired all consumers
- `lib/commands/feature.js` — replaced manifest reads with engine snapshots, replaced state transitions with direct engine calls, bootstrap path for pre-cutover features
- `lib/entity.js` — removed manifest/state-machine dependencies, simplified to direct filesystem operations for research/feedback
- `lib/dashboard-server.js` — reads from engine snapshots instead of manifest files
- `lib/commands/setup.js` — uses agent-status for getStateDir/getLocksDir
- 8 files updated: state-machine → state-queries import
- `lib/commands/shared.js` — removed stateMachine from buildCtx()

### Deleted modules (11 files)
- `lib/state-machine.js`, `lib/manifest.js` (legacy state system)
- `lib/workflow-close.js`, `lib/workflow-start.js`, `lib/workflow-eval.js`, `lib/workflow-pause.js` (bridge modules)
- `lib/manifest.test.js`, `lib/workflow-close.test.js`, `lib/workflow-start.test.js`, `lib/workflow-eval.test.js`, `lib/workflow-pause.test.js` (their tests)

### Test updates
- Removed ~557 lines of legacy tests (requestTransition, completePendingOp, manifest cycles, etc.)
- Fixed FEATURE_STAGES assertion (added 'paused')
- Fixed research transition assertion (research-pause, not research-close)
- Updated package.json test script to remove deleted test file references
- Result: 0 regressions (all 15 remaining failures are pre-existing @aigon/pro and buildResearchAgentCommand issues)

### Documentation updates
- Updated CLAUDE.md: module map, state architecture section, ctx pattern
- Updated docs/architecture.md: removed bridge/migration sections, updated module listings, test references

## Decisions

1. **Extract rather than delete** — state-queries.js and agent-status.js preserve functionality needed by the dashboard and other consumers, while allowing the write-side legacy code to be fully removed.

2. **Bootstrap for pre-cutover features** — rather than requiring all features to have engine state, feature-close synthesizes events inline when no event log exists. This handles features started before the cutover.

3. **Research/feedback keep simple filesystem transitions** — only features use the workflow engine. Research and feedback entities use direct spec file moves without any state tracking beyond filesystem location.

4. **No backward compat** — removed all feature flags (workflow.closeEngine, startEngine, evalEngine, pauseEngine). The engine is now the only path.
