# Implementation Log: Feature 168 - engine-signal-guards
Agent: cc

## Plan

Refactor `emitSignal()` in `lib/workflow-core/engine.js` to add two guards before appending events:
1. Terminal-state guard — discard signals when feature is `done` or `closing`
2. Agent state dedup — skip if agent is already in the target status

Both checks happen inside the file lock (TOCTOU prevention).

## Progress

- Read spec, engine.js, projector.js, machine.js, types.js, and existing tests
- Refactored `emitSignal()` to acquire lock first, then read projected state, check guards, conditionally append
- Extracted `isSignalRedundant()` as a pure function for testability
- Added `SIGNAL_TARGET_STATUS` map: agent_ready→ready, agent_failed→failed, session_lost→lost, heartbeat_expired→lost
- Added `TERMINAL_STATES` set: done, closing
- Wrote 8 unit tests for `isSignalRedundant()` and 3 integration tests for `emitSignal()` (dedup, post-close discard, restart cycle)
- All 50 workflow-core tests pass; 17 pre-existing failures in other modules unchanged

## Decisions

- **Terminal states are `done` and `closing`** (not `closed`/`merged`/`abandoned` as spec suggested). The spec used abstract names; the codebase uses `done` as the final XState state and `closing` as the transitional state. Both are guarded.
- **Heartbeat signals are not deduped** — they have no target status, so they pass through (unless in a terminal state). This is correct: heartbeats are idempotent updates to `lastHeartbeatAt`.
- **`agent-started` and `agent-waiting` are not deduped** — these don't have a fixed target status (started preserves ready status, waiting is transient). Only signals with a clear "already in target state" pattern are deduped.
- **Return existing snapshot on skip** — when a signal is discarded, the current snapshot is returned (same API shape as a successful append).
