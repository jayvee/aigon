# Feature: Engine-Driven Actions for All Interfaces

## Summary

Two problems need solving together:

**1. Actions are incomplete.** The workflow engine only knows about lifecycle actions (pause, resume, eval, close, restart-agent). UI-convenience actions like "open tmux session" and "attach to agent" are computed by the dashboard frontend, making them invisible to the CLI board, terminal UI, slash commands, or any other interface.

**2. Agent liveness is broken.** The heartbeat sidecar touches a file every 30 seconds, but nothing bridges that file to the engine. The supervisor was neutered (observation-only, no signal emission). So agents go to `lost` status within 2-3 minutes of starting, even when they're actively running. This makes the dashboard show "Not started" / "Restart agent" for healthy agents, and hides the "Open" action that should be shown.

Both problems stem from the same root cause: the engine doesn't know about operational state (sessions, liveness) — only lifecycle state (implementing, evaluating, done). This feature makes the engine aware of both.

## User Stories

- [ ] As a user, I want running agents to stay "Running" on the dashboard instead of going "lost" after 2 minutes
- [ ] As a user, I want to see an "Open" button for any running agent so I can attach to its tmux session
- [ ] As a developer building a terminal UI, I want to get all available actions from the engine API without reimplementing dashboard logic
- [ ] As a user, I want actions to be consistent regardless of which interface I use

## Acceptance Criteria

### Agent liveness works
- [ ] The supervisor (or heartbeat sweep) reads heartbeat files and emits `signal.heartbeat` events to the engine for agents with fresh file timestamps
- [ ] Running agents stay in `running` status as long as their heartbeat file is being touched
- [ ] Agents only go to `lost` when the heartbeat file stops being touched (agent actually died)
- [ ] The supervisor loop is no longer neutered — it emits signals based on heartbeat file freshness

### Engine knows about all action types
- [ ] `FEATURE_ACTION_CANDIDATES` includes: `open-session` (per-agent, when agent is running and has a tmux session)
- [ ] `RESEARCH_ACTION_CANDIDATES` includes the equivalent
- [ ] `deriveAvailableActions()` returns session actions with enough metadata for any UI

### Actions carry UI-agnostic metadata
- [ ] Each action includes:
  - `kind` — machine-readable identifier (e.g. `open-session`, `pause-feature`)
  - `label` — human-readable default label
  - `agentId` — which agent (null for entity-level actions)
  - `category` — `lifecycle` | `agent-control` | `session`
  - `command` — aigon CLI command string
  - `tmuxSession` — for session actions, the tmux session name
- [ ] Command string formatting happens in the engine layer, not per-UI

### Dashboard renders engine actions only
- [ ] Dashboard renders `availableActions` from the API — no frontend action computation
- [ ] "Open" / "Attach" buttons come from engine `open-session` actions
- [ ] `buildFeatureActions()` frontend derivation logic is deleted or reduced to pure rendering

### Other interfaces get the same actions
- [ ] `aigon board` renders actions from the engine
- [ ] `/api/status` and `/api/detail` return the full action list with metadata

## Validation

```bash
node -c aigon-cli.js
node -c lib/workflow-core/actions.js
node -c lib/feature-workflow-rules.js
node -c lib/supervisor.js
node -c lib/workflow-heartbeat.js

# Supervisor must emit signals (not just log)
grep -q 'emitSignal\|emitResearchSignal' lib/supervisor.js || { echo "FAIL: supervisor must emit signals"; exit 1; }

# Engine must know about open-session
grep -q 'OPEN_SESSION\|open.session' lib/feature-workflow-rules.js || { echo "FAIL: engine must know about open-session action"; exit 1; }

# Dashboard must not compute its own actions
if grep -q 'buildFeatureActions' templates/dashboard/js/actions.js 2>/dev/null; then
  echo "FAIL: buildFeatureActions still exists in frontend"
  exit 1
fi
```

## Technical Approach

### 1. Fix the heartbeat bridge (supervisor → engine)

The supervisor already runs every 30 seconds and checks heartbeat files. It was neutered after it broke working features. The fix:

- Read each agent's heartbeat file timestamp
- If fresh (within 2x the heartbeat interval): emit `signal.heartbeat` to the engine
- If stale (beyond timeout): emit `signal.heartbeat_expired`
- Add a guard: only emit if the agent's current engine status would actually change (prevents the old bug of re-emitting redundant signals)

The `isSignalRedundant()` function in `engine.js` already handles this — the supervisor just needs to call it before emitting.

### 2. Add session actions to action candidates

In `feature-workflow-rules.js`, add `OPEN_SESSION` to `FEATURE_ACTION_CANDIDATES`. These are not state transitions — they're informational. Handle them in `deriveAvailableActions()` with a simple guard (agent exists, status is running/implementing, tmux session name is computable) instead of routing through XState.

### 3. Enrich action output with metadata

Add `category`, `command`, and `tmuxSession` fields to the action objects returned by `deriveAvailableActions()`.

### 4. Strip frontend action derivation

Dashboard reads `availableActions` from API, groups by `category`, renders. No guard logic, no action filtering.

### Key files to modify:

- `lib/supervisor.js` — re-enable signal emission with redundancy guard
- `lib/workflow-heartbeat.js` — ensure sweep is called by supervisor
- `lib/feature-workflow-rules.js` — add OPEN_SESSION to candidates
- `lib/research-workflow-rules.js` — same
- `lib/workflow-core/types.js` — add OPEN_SESSION to ManualActionKind
- `lib/workflow-core/actions.js` — enrich output, handle non-transition actions
- `lib/action-command-mapper.js` — handle open-session
- `templates/dashboard/js/actions.js` — strip derivation, render engine actions

## Dependencies

- depends_on: unified-workflow-engine (178, done)
- depends_on: single-source-of-truth-for-agent-status (179, done)

## Out of Scope

- Building a new terminal UI (just ensure the data is there)
- Feedback entity actions (stays on state-queries)
- Changing lifecycle transitions (pure consolidation + session actions + liveness fix)

## Open Questions

- Should `open-session` actions bypass XState entirely (simple guard function) or go through the machine as noop events?
- Should the supervisor emit signals directly or write to a queue that the engine processes?

## Related

- Feature 178: Unified Workflow Engine (done)
- Feature 179: Complete the Engine Migration (done)
- Feature 182: Engine Cleanup — Remove Legacy Bypasses (in progress)
