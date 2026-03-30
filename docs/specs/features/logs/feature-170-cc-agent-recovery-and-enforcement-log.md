# Implementation Log: Feature 170 - agent-recovery-and-enforcement
Agent: cc

## Plan

Implement compensating transactions (auto-restart, drop, force-ready) with configurable recovery policy, plus CC Stop hook and GG AfterAgent advisory enforcement. Leveraged existing engine methods and XState guards as foundation.

## Progress

- Added `recovery.autoRestart` and `recovery.maxRetries` config with defaults (true, 2)
- Added `needs_attention` agent status to types, projector, and machine
- Added `restartCount` tracking — incremented on each `agent.restarted` event
- Added `escalateAgent()` engine method for needs-attention transitions
- Implemented `sweepAgentRecovery()` in workflow-heartbeat.js — orchestrates auto-restart up to maxRetries, then escalates
- Integrated recovery sweep into dashboard `pollStatus` loop (fire-and-forget async)
- Added `force-agent-ready` and `drop-agent` CLI commands (wired through /api/action)
- Added `check-agent-submitted` CLI command (CC Stop hook enforcement — blocks exit if not submitted)
- Added `check-agent-signal` CLI command (GG AfterAgent advisory — warns but doesn't block)
- Configured CC Stop hook in `templates/agents/cc.json`
- Configured GG AfterAgent hook in `templates/agents/gg.json`
- Updated snapshot adapter to map `needs_attention` to `needs-attention` dashboard status
- Updated `agentRecoverable` and `agentDroppable` guards to accept `needs_attention` status
- Added recovery event types to `filterAgentSignalEvents`
- Wrote 12 new tests — all 39 workflow-signals tests pass

## Decisions

- **restartCount in projector, not machine context**: The restart count is tracked during event replay in the projector rather than as XState assign action. This keeps the machine simpler (it only manages status transitions) while the projector handles the accumulation.
- **needs-attention is an explicit agent status, not a feature-level flag**: This aligns with the existing per-agent status model and makes it natural for the dashboard to show per-agent recovery actions.
- **Recovery sweep is fire-and-forget in pollStatus**: The sweep runs asynchronously after each poll cycle. Errors are logged but don't block the poll loop. This keeps the dashboard responsive.
- **Advisory-only for GG**: The spec calls for advisory warnings for GG because its hook system is less mature. `check-agent-signal` always exits 0.
- **Open questions from spec**: Auto-restart reuses the existing worktree (same tmux session name pattern). The restart preserves the agent's log file (restarts append, don't overwrite).

## Files Changed (12)

- `lib/config.js` — recovery config defaults and `getRecoveryConfig()`
- `lib/workflow-core/types.js` — `NEEDS_ATTENTION` agent status
- `lib/workflow-core/machine.js` — `markNeedsAttention` action, `agentNeedsAttention` guard, `needs-attention` event
- `lib/workflow-core/projector.js` — `restartCount` tracking, `agent.needs_attention` event replay
- `lib/workflow-core/engine.js` — `escalateAgent()` method
- `lib/workflow-heartbeat.js` — `sweepAgentRecovery()` function
- `lib/workflow-snapshot-adapter.js` — `needs_attention` mapping, recovery event filtering
- `lib/dashboard-server.js` — recovery sweep integration in pollStatus
- `lib/commands/misc.js` — `check-agent-submitted`, `check-agent-signal`, `force-agent-ready`, `drop-agent` commands
- `templates/agents/cc.json` — Stop hook configuration
- `templates/agents/gg.json` — AfterAgent hook configuration
- `lib/workflow-signals.test.js` — 12 new tests

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-30

### Findings
- `recovery.autoRestart: false` left agents stuck in `lost`/`failed` because `sweepAgentRecovery()` returned early instead of escalating them to `needs_attention`, which blocked the intended manual `drop-agent` / `force-agent-ready` recovery path.

### Fixes Applied
- `fix(review): escalate lost agents when auto-restart is disabled`

### Notes
- Verified with `node lib/workflow-signals.test.js` (`39 passed, 0 failed`).
- `npm test` is currently red in unrelated existing areas, including research eval, insights, and model-resolution tests.
