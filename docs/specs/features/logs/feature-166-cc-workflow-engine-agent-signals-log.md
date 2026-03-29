---
commit_count: 5
lines_added: 911
lines_removed: 12
lines_changed: 923
files_touched: 13
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 728
output_tokens: 33284
cache_creation_input_tokens: 669541
cache_read_input_tokens: 18542121
thinking_tokens: 0
total_tokens: 19245674
billable_tokens: 34012
cost_usd: 42.8743
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: 36.85
---
# Implementation Log: Feature 166 - workflow-engine-agent-signals
Agent: cc

## Plan

Wire agent lifecycle events (submit, error, session loss, heartbeat) into
the workflow-core engine as first-class signals. The engine already had
`emitSignal()` and `signalAgentReady()` — the gap was that nothing called
them from the CLI commands.

## Progress

- Explored workflow-core engine: signal infrastructure already complete
- Added `signal.heartbeat` to engine (applyTransition + projector)
- Wired `agent-status` command to emit engine signals alongside legacy writes
- Wired `sessions-close` to emit `signal.session_lost` for killed tmux sessions
- Added event log reading + signal filtering to snapshot adapter
- Dashboard now serves `workflowEvents` array for Events tab
- Created `lib/workflow-heartbeat.js` for heartbeat emission + sweep
- 29 new tests, all passing; 123 existing tests unchanged

## Decisions

- **Dual-write pattern**: Engine signals are emitted alongside (not instead of)
  legacy manifest writes. This preserves backward compatibility for features
  without engine state.
- **Best-effort signals**: Engine signal emission is async and non-fatal — if it
  fails, the legacy write already succeeded.
- **Heartbeat as file check, not file touch**: Heartbeat uses engine events
  (`signal.heartbeat`) rather than file touches, giving a complete audit trail.
- **Sweep is callable, not auto-running**: The heartbeat sweep function exists
  but isn't wired into the dashboard polling loop — that's phase 5 orchestrator
  territory (out of scope per spec).
- **Initial agent status is 'running'** (not 'idle'): Discovered during testing
  that `startFeature` creates agents with status 'running'.
- **timeoutMs=0 edge case**: Fixed truthiness check to `!== undefined` to support
  0ms timeout in tests.

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-30

### Findings
- The dashboard detail API did not expose workflow-core signal events, so the
  Events tab still rendered from `manifest.events` and stayed empty for engine
  features.

### Fixes Applied
- Added unified detail payload events that prefer workflow-core signal events
  for engine-backed features.
- Updated the detail tabs to render and compute stats from the unified event
  list, including `agentId` display for signal events.
- Added a regression test covering workflow-core event delivery in
  `buildDetailPayload()`.

### Notes
- Targeted verification passed: `node --check lib/dashboard-server.js`,
  `node --check templates/dashboard/js/detail-tabs.js`,
  `node lib/dashboard-server.test.js`, and `node lib/workflow-signals.test.js`.
