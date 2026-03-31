# Feature: fix-heartbeat-and-liveness-system

## Summary

The heartbeat and liveness system is currently disabled because it broke every running feature. The supervisor was marking agents as `lost` (mutating engine state) and there was no automatic recovery. A working agent session would get stuck in `lost` state and disappear from the dashboard. The system needs to be redesigned so it helps rather than hinders.

## What went wrong

1. Supervisor emitted `signal.session_lost` and `signal.heartbeat_expired` into the engine, transitioning agents to `lost`
2. No automatic recovery path: once `lost`, the engine required manual `restart-agent` to go back to `running`
3. Heartbeat sidecar had startup delay, so agents were marked `lost` before their first heartbeat
4. `lost` is a one-way trap — heartbeats from a `lost` agent were ignored
5. The supervisor ran every 30 seconds but heartbeat timeout was 2 minutes — race conditions everywhere

## Current state (disabled)

The supervisor now logs observations only — no engine mutations. This is safe but means liveness detection is entirely manual. The heartbeat sidecar still runs and touches files, but nothing reads them for state transitions.

## Acceptance Criteria

- [ ] A working agent session is NEVER marked `lost` by the system
- [ ] A genuinely dead agent session (tmux dead + heartbeat expired + no recovery after N minutes) IS surfaced to the user as a problem — but as a dashboard notification/badge, not as an engine state change
- [ ] The user explicitly decides to mark an agent as lost/failed via a dashboard action or CLI command — the system never does this automatically
- [ ] Heartbeat data is used for display purposes only (e.g., "last seen 5 minutes ago") — not for engine state transitions
- [ ] The supervisor module remains observe-and-notify only — it never emits signals that change engine state
- [ ] Agent sessions that crash and restart automatically update their display status without manual intervention
- [ ] The dashboard shows agent liveness indicators (green=heartbeat fresh, yellow=stale, red=dead) without changing engine lifecycle state

## Technical Approach

The fundamental redesign: **heartbeat is a display concern, not a state concern**. The engine manages lifecycle (implementing, submitted, etc.). The dashboard displays liveness (alive, stale, dead) as a separate overlay.

1. Heartbeat data stays as file touches in `.aigon/state/heartbeat-{id}-{agent}`
2. The AIGON server reads heartbeat timestamps during polling and includes them in the status payload
3. The dashboard renders liveness indicators based on heartbeat freshness
4. The supervisor sends notifications for genuinely dead sessions (tmux gone + heartbeat expired) but NEVER changes engine state
5. The user can click "Mark as lost" or "Force submit" in the dashboard if they decide the agent is dead — this is the only path to changing engine state for liveness

## Dependencies

- None

## Out of Scope

- Automatic agent restart (user decides)
- Changing the heartbeat sidecar mechanism
- Research workflow liveness (features first)
