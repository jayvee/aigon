# Implementation Log: Feature 169 - shell-trap-signal-infrastructure
Agent: cc

## Plan
- Wrap `buildAgentCommand()` with bash `trap EXIT` handler
- Add heartbeat sidecar (background file-touch loop)
- Add `signals` capability block to all agent JSON configs
- Update heartbeat timeout default from 90s to 120s
- Add new `heartbeat.*` config path with fallback to legacy `workflow.*`

## Progress
- Refactored `buildAgentCommand()` into `buildRawAgentCommand()` (original logic) + `buildAgentCommand()` (shell trap wrapper)
- Added `getAgentSignalCapabilities()` to read per-agent signal config from templates
- Added `_getHeartbeatIntervalSecs()` to read heartbeat interval from project config
- Added `signals` block to all 5 agent configs (cc, gg, cx, cu, mv)
- Updated `workflow-heartbeat.js`: timeout 90s→120s, new `heartbeat.*` config path
- Created `lib/shell-trap.test.js` with 23 unit tests (all passing)
- Updated CLAUDE.md with new module info and state architecture notes

## Decisions
- **No double bash wrapping**: The shell trap script is returned as plain multi-line bash, not wrapped in `bash -lc`. All callers (`createDetachedTmuxSession`, `openTerminalAppWithCommand`, etc.) already wrap commands in `bash -lc`, so the trap/heartbeat lines are included naturally.
- **Universal baseline**: Unknown agents (no `signals` block) default to shellTrap=true, heartbeatSidecar=true, cliHooks=null. This means new agents automatically participate without config changes.
- **Heartbeat file path**: `.aigon/state/heartbeat-{featureId}-{agentId}` — simple touch-based, separate from the engine heartbeat emit which is the agent-status command's responsibility.
- **Pre-existing test failures**: 17 failures in `aigon-cli.test.js` are pre-existing (research-eval, feature-eval tests), not caused by these changes.

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-30

### Findings
- Heartbeat sidecar files were being written inside the worktree's `.aigon/state` directory, but shared lifecycle state lives in the main repo. That would make the orchestrator miss live heartbeats for worktree-backed agent sessions.

### Fixes Applied
- Resolved the heartbeat state directory from `.aigon/worktree.json` so worktree sessions now touch heartbeat files in the main repo's `.aigon/state`.
- Added a regression test covering worktree heartbeat placement.

### Notes
- Targeted validation passed: `node --check lib/worktree.js` and `node lib/shell-trap.test.js`.
