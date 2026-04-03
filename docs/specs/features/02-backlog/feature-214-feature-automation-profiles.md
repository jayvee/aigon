# Feature: feature automation profiles

## Summary

Replace the current vague `feature-autopilot` model with a clearer, stage-based autonomous execution system. The user-facing concept shifts from "autopilot" to "start autonomously" — you choose who implements, who evaluates, and where autonomy stops. Internally, a dedicated `feature-run` CLI command spawns a long-running monitor process in its own tmux session (role: `auto`) that drives the feature through configured stages using workflow-core state as the only authority. The AIGON server stays completely read-only — it displays liveness via the existing heartbeat infrastructure. No new files, no new servers, no new write paths.

**Architecture**: Option A — standalone tmux-based monitor process. The server is not involved in orchestration.

**Prerequisites**:
- Feature 212 (fix autopilot to use workflow-core engine) — ✅ Done
- Feature 213 (standardise tmux session naming with explicit role prefix) — `auto` role required

## User Stories

- [ ] As a developer, I can start a feature autonomously from the CLI by choosing implementation agents, an evaluator, and where autonomy stops — without managing a long-running terminal session.
- [ ] As a developer, I can start a feature autonomously from the dashboard with the same explicit choices.
- [ ] As a user, I can see on the dashboard whether the autonomous run is active, completed, or has stopped — without the server needing to own any orchestration state.
- [ ] As a maintainer, the server remains read-only and the autonomous monitor is just another tmux session — if it crashes, I restart it with the same command.

## Acceptance Criteria

### CLI: `aigon feature-run`

- [ ] `aigon feature-run <id> <agents...> [--eval-agent=<agent>] [--stop-after=implement|eval|close|deploy]` is the primary command
- [ ] `--stop-after` defaults to `eval` (safe default: no automatic close or deploy)
- [ ] `--eval-agent` defaults to the first implementation agent if not specified
- [ ] The command calls `feature-start` if worktrees do not already exist
- [ ] The command spawns a dedicated monitor tmux session named `{repo}-f{id}-auto(-desc)` (per feature-213 naming convention) and exits immediately — no blocking terminal
- [ ] `aigon feature-run <id> status` prints whether the `auto` tmux session is alive and the current workflow-core state
- [ ] `aigon feature-autopilot` is retained as a compatibility wrapper that maps its arguments to `feature-run` with `--stop-after=eval`

### Monitor session behaviour

- [ ] The monitor session (`auto` role) touches `.aigon/state/heartbeat-{featureId}-auto` every 30s — reusing the existing heartbeat infrastructure
- [ ] The monitor polls the workflow-core engine snapshot every 30s to determine when each stage is complete
- [ ] When all agents are ready per the engine snapshot, the monitor invokes `aigon feature-eval <id> --agent=<eval-agent>`
- [ ] The monitor waits for `currentSpecState === evaluating` in the engine snapshot before logging "evaluation started"
- [ ] When `--stop-after=eval` and evaluation is complete, the monitor prints the next manual step (`aigon feature-close <id>`) and exits cleanly
- [ ] If a stage command fails, the monitor logs the error clearly and exits — it does not retry
- [ ] The monitor session output is readable via `tmux attach -t {repo}-f{id}-auto-{desc}`

### Dashboard UX

- [ ] The dashboard reads the existing heartbeat file for the `auto` role to determine if a monitor session is alive — no new API or file format
- [ ] A feature with a live `auto` heartbeat shows a `Running autonomously` indicator
- [ ] A feature whose `auto` heartbeat has gone stale shows a `Autonomous run may have stopped` warning
- [ ] Backlog features surface a `Start Autonomously` primary action
- [ ] Clicking `Start Autonomously` opens a modal with: implementation agent multi-select, evaluator agent select, and `Stop after` selector
- [ ] The dashboard action POSTs to the server which spawns `aigon feature-run <id> ...` as a child process and returns immediately — the server does not monitor or orchestrate further
- [ ] The dashboard no longer implies "autopilot" means fully autonomous merge/close

### Server stays read-only

- [ ] The server does not poll automation state or invoke any stage commands
- [ ] The server only reads the heartbeat file to display liveness (same as agent heartbeats today)
- [ ] No new server poll loops, no new endpoints beyond the one that spawns `feature-run`

### Regression safety

- [ ] Existing non-autonomous flows (feature-start, feature-do, feature-eval, feature-close) are unaffected
- [ ] `npm test` passes
- [ ] `node -c` on all modified files passes

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/dashboard-server.js
npm test
```

Manual validation:
- Run `aigon feature-run <id> cc gg --eval-agent=gg --stop-after=eval`
- Confirm `{repo}-f{id}-auto-{desc}` tmux session is created and exits after spawning agents
- Attach to monitor session and confirm it logs progress as agents complete
- Confirm `feature-eval` is triggered automatically when both agents are ready per engine snapshot
- Confirm monitor exits cleanly after eval with next-step instructions
- Confirm dashboard shows `Running autonomously` while heartbeat is fresh
- Confirm `aigon feature-autopilot <id> cc gg` works via the compatibility wrapper
- Confirm a non-automated feature running in parallel is unaffected

## Technical Approach

### 1. Monitor session

`feature-run` spawns a single dedicated tmux session with role `auto` (per feature-213). The session runs a monitor loop:

```
while true:
  read engine snapshot
  if all agents ready → invoke feature-eval, wait for evaluating state, log result
  if stop-after stage complete → print next step, exit 0
  if error → log error, exit 1
  touch heartbeat file
  sleep 30
```

The monitor uses `buildTmuxSessionName(id, null, { role: 'auto', desc })` — no agent argument since `auto` sessions are agent-less.

### 2. Heartbeat

The monitor touches `.aigon/state/heartbeat-{featureId}-auto` every 30s. The dashboard reads it the same way it reads agent heartbeats — via `lib/workflow-heartbeat.js`. No new infrastructure needed.

### 3. Dashboard liveness display

Extend the existing heartbeat liveness check in `lib/dashboard-status-helpers.js` to also check for the `auto` heartbeat file. Show the `Running autonomously` indicator if it is fresh (within 2x the 30s touch interval = 60s threshold).

### 4. Dashboard action

The `Start Autonomously` action POSTs to a new lightweight endpoint (e.g. `POST /api/features/:id/run`) which:
- Validates the request (agents, eval-agent, stop-after)
- Spawns `aigon feature-run <id> <agents> --eval-agent=<agent> --stop-after=<stage>` as a child process
- Returns `{ started: true }` immediately

The server does nothing further. The child process is fully independent.

### 5. `--stop-after` stages

| Stage | What the monitor does when reached |
|---|---|
| `implement` | Exits after all agents submit — does not trigger eval |
| `eval` | Triggers eval, waits for completion, then exits (default) |
| `close` | Triggers eval then close — out of scope for now, logs warning |
| `deploy` | Out of scope, logs warning |

`close` and `deploy` are accepted as valid inputs but print a clear "not yet supported" message and behave as `eval` for now.

### 6. Compatibility wrapper

```js
// aigon feature-autopilot <id> <agents...>
// → aigon feature-run <id> <agents...> --stop-after=eval
```

No behaviour change for existing autopilot users.

## Dependencies

- Feature 213 — `auto` tmux session role (must land first)
- `lib/commands/feature.js` — `feature-run` command, `feature-autopilot` wrapper, monitor loop
- `lib/worktree.js` — `buildTmuxSessionName` with `role: 'auto'`, heartbeat file path
- `lib/workflow-heartbeat.js` — existing heartbeat reading (no changes, just reuse)
- `lib/dashboard-status-helpers.js` — extend heartbeat check for `auto` role
- `lib/dashboard-server.js` — new `/api/features/:id/run` spawn endpoint, `Start Autonomously` action dispatch
- `lib/action-command-mapper.js` — `Start Autonomously` action wiring
- `templates/dashboard/js/actions.js` — dashboard action definition
- `templates/dashboard/index.html` or modular equivalent — `Start Autonomously` modal UI
- `docs/development_workflow.md` — update to reflect new autonomous flow

## Out of Scope

- Server orchestration of any kind
- `automation.json` or any new persistent file format
- `close: auto` and `deploy: auto` (modelled but not implemented)
- `review: auto`
- Research autonomous execution
- Automatic retry on failure

## Open Questions

- None — architecture settled in design discussion

## Related

- Feature 212: fix-autopilot-to-use-workflow-core-engine — ✅ Done (prerequisite)
- Feature 213: standardise-tmux-session-naming-with-explicit-role-prefix — prerequisite
- `lib/workflow-heartbeat.js` — heartbeat reading infrastructure
- `lib/worktree.js` — session naming and heartbeat paths
