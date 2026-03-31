# Implementation Log: Feature 187 - fix-heartbeat-and-liveness-system
Agent: cc

## Plan

Redesign heartbeat/liveness as a display-only system. The engine should never transition agents to `lost` based on heartbeat data. Instead, liveness indicators are computed for dashboard display.

## Progress

- Removed `status: 'lost'` transitions from `signal.session_lost` and `signal.heartbeat_expired` in both engine context reducers and the projector
- Removed `SIGNAL_TARGET_STATUS` entries for session_lost and heartbeat_expired
- Rewrote `lib/workflow-heartbeat.js`: removed `sweepExpiredHeartbeats` and `sweepAgentRecovery`, added `computeAgentLiveness` (pure function) and `readHeartbeatFileTimestamp`
- Rewrote `lib/supervisor.js`: removed all `workflowEngine.emitSignal` calls, replaced with in-memory liveness computation via `computeAgentLiveness`. Added `getAgentLiveness()` for dashboard access.
- Added liveness data (liveness, lastSeenAt, heartbeatAgeMs) to feature and research agent rows in `dashboard-status-collector.js`
- Added liveness dot indicators (green/yellow/red) to dashboard UI in both list and monitor views
- Updated all tests to reflect new behavior (17/18 suites pass, 1 pre-existing failure unrelated to changes)
- Updated CLAUDE.md module descriptions and state architecture docs

## Decisions

- **Heartbeat is display-only**: the fundamental design change. The engine manages lifecycle (implementing, submitted, etc.). The dashboard displays liveness (alive, stale, dead) as a separate overlay.
- **Three liveness levels**: alive (within 2min timeout), stale (2-5min), dead (>5min). Configurable via `.aigon/config.json`.
- **Tmux trumps heartbeat**: if tmux session is alive, agent is always considered alive regardless of heartbeat age.
- **Desktop notifications remain**: supervisor still sends macOS/Linux notifications when an agent transitions to dead, but never changes engine state.
- **Used `agent-failed` instead of `session-lost`** in recovery tests since session-lost no longer produces a recoverable state.
