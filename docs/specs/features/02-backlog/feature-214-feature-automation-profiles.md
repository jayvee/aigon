# Feature: feature automation profiles

## Summary

Replace the current vague `feature-autopilot` model with a clearer autonomous execution system. The user-facing concept shifts from "autopilot" to "start autonomously" — you choose who implements, who evaluates, and where autonomy stops. Internally, a dedicated **AutoConductor** tmux session (role: `auto`) observes workflow-core state and launches the next valid stage command when prerequisites are satisfied. The AutoConductor is not a source of truth: workflow-core remains authoritative, and implementation/eval sessions remain normal tmux work sessions. If the AutoConductor dies, the feature degrades cleanly into normal manual mode with no special recovery state required. The AIGON server remains a launcher and read-side surface only. No new persistent metadata files are introduced in this version.

**Architecture**: standalone tmux-based AutoConductor session. The server is not the orchestrator.

**Prerequisites**:
- Feature 212 (fix autopilot to use workflow-core engine) — ✅ Done
- Feature 213 (standardise tmux session naming with explicit role prefix) — `auto` role required

## User Stories

- [ ] As a developer running a solo feature, I can start it autonomously and walk away — the AutoConductor handles implementation and close without me touching anything.
- [ ] As a developer running a Fleet feature, I can start it autonomously and walk away until after eval — the AutoConductor handles implementation and eval, then I pick the winner and close.
- [ ] As a developer, I can start a feature autonomously from the dashboard with the same explicit choices as the CLI.
- [ ] As a user, I can see on the dashboard whether the AutoConductor is active or has finished, without the server needing to own orchestration state.
- [ ] As a maintainer, the AutoConductor is just another tmux session — if it crashes, the feature falls back to normal manual workflow instead of entering a broken intermediate state.

## Acceptance Criteria

### CLI: `aigon feature-autonomous-start`

- [ ] `aigon feature-autonomous-start <id> <agents...> [--eval-agent=<agent>] [--stop-after=implement|eval|close]` is the primary command
- [ ] `--stop-after` defaults to `close` — the genuinely useful default; users who want to pause before closing pass `--stop-after=eval` explicitly
- [ ] `--eval-agent` is only relevant for Fleet mode (2+ agents); ignored in solo mode which has no eval stage
- [ ] The command calls `feature-start` if worktrees do not already exist
- [ ] The command spawns a dedicated AutoConductor tmux session named `{repo}-f{id}-auto(-desc)` (per feature-213 naming convention) and exits immediately
- [ ] `aigon feature-autonomous-start status <id>` prints whether the `auto` tmux session is alive and the current workflow-core state
- [ ] `aigon feature-autopilot` is removed — users should use `feature-autonomous-start` directly

### AutoConductor session behaviour

- [ ] The AutoConductor polls the workflow-core engine snapshot every 30s to determine when each stage is complete
- [ ] When `--stop-after=implement`: the AutoConductor exits after all implementation agents are ready and prints the next manual step
- [ ] **Solo mode** (`--stop-after=close`, one agent): AutoConductor waits for agent to submit, then invokes `aigon feature-close <id>` — no eval stage, winner is auto-selected by the engine
- [ ] **Fleet mode** (`--stop-after=eval`, 2+ agents): AutoConductor waits for all agents to submit, invokes `aigon feature-eval <id> --agent=<eval-agent>`, waits for `currentSpecState === evaluating`, then exits and prints next manual step (winner selection + close)
- [ ] **Fleet mode** (`--stop-after=close`, 2+ agents): not supported in v1 — AutoConductor falls back to `--stop-after=eval` behaviour and logs a clear message explaining that Fleet close requires manual winner selection; a future `feature-select-winner` CLI command will enable this path
- [ ] If a stage command fails, the AutoConductor logs the error clearly and exits — it does not retry
- [ ] If the AutoConductor session dies for any reason, implementation and eval sessions continue normally and the feature can be completed manually
- [ ] The AutoConductor session output is readable via `tmux attach -t {repo}-f{id}-auto-{desc}`

### Dashboard UX

- [ ] The dashboard checks tmux session existence for the `auto` role session (`{repo}-f{id}-auto-{desc}`) — same mechanism used for all other sessions, no new infrastructure
- [ ] A feature with a live `auto` tmux session shows a `Running autonomously` indicator
- [ ] A feature with no `auto` tmux session shows no indicator (AutoConductor finished or was never started)
- [ ] Backlog features surface a `Start Autonomously` primary action
- [ ] Clicking `Start Autonomously` opens a modal with: implementation agent multi-select, evaluator agent select, and `Stop after` selector
- [ ] The dashboard action POSTs to the server which spawns `aigon feature-autonomous-start <id> ...` as a child process and returns immediately — the server does not monitor or orchestrate further
- [ ] The dashboard no longer implies "autopilot" means fully autonomous merge/close

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
- **Solo end-to-end**: `aigon feature-autonomous-start <id> cc` — confirm AutoConductor triggers `feature-close` automatically after agent submits, feature reaches done state with zero intervention
- **Fleet to eval**: `aigon feature-autonomous-start <id> cc gg --eval-agent=gg --stop-after=eval` — confirm `feature-eval` is triggered automatically, AutoConductor exits cleanly with next-step instructions
- **AutoConductor resilience**: kill the `auto` tmux session mid-run and confirm the feature can still be finished manually
- **Dashboard liveness**: confirm `Running autonomously` indicator while `auto` tmux session is alive, indicator gone after AutoConductor exits
- **Removal**: confirm `aigon feature-autopilot` returns a clear "use feature-autonomous-start" error
- **No interference**: a non-automated feature running in parallel is unaffected

## Technical Approach

### 1. AutoConductor session

`feature-autonomous-start` spawns a single dedicated tmux session with role `auto` (per feature-213). The session runs the AutoConductor loop:

```
while true:
  read engine snapshot
  determine current stage based on snapshot state + --stop-after
  invoke next stage command if prerequisites satisfied
  if stop-after stage complete → print next step, exit 0
  if error → log error, exit 1
  sleep 30
```

The AutoConductor uses `buildTmuxSessionName(id, null, { role: 'auto', desc })` — no agent argument since `auto` sessions are agent-less.

The AutoConductor is deliberately lightweight:
- not a lifecycle authority
- does not own agent session state
- does not persist orchestration metadata
- if it stops, the feature degrades to manual mode

**Extensibility**: new stage sequences are new cases in the loop. The AutoConductor can be extended to support `implement → review → close` (or any other ordered sequence) by adding the relevant engine state checks and CLI invocations to the loop. The `--stop-after` flag is the natural extension point.

### 2. Dashboard liveness display

Extend `lib/dashboard-status-helpers.js` to check for an `auto` role tmux session alongside existing agent session checks. Uses `matchTmuxSessionByEntityId` with the `auto` role — same path as all other session liveness checks. No heartbeat file, no new infrastructure.

### 3. Dashboard action

The `Start Autonomously` action POSTs to a new lightweight endpoint (e.g. `POST /api/features/:id/run`) which:
- Validates the request (agents, eval-agent, stop-after)
- Spawns `aigon feature-autonomous-start <id> <agents> --eval-agent=<agent> --stop-after=<stage>` as a child process
- Returns `{ started: true }` immediately

The server does nothing further. The child process is fully independent.

### 4. `--stop-after` stages

| Stage | Solo (1 agent) | Fleet (2+ agents) |
|---|---|---|
| `implement` | Exit after agent submits, print next step | Exit after all agents submit, print next step |
| `eval` | n/a — solo has no eval stage; treated as `close` | Trigger eval, wait for completion, exit and print next step |
| `close` | Trigger `feature-close` after agent submits ✅ end-to-end | Not supported in v1 — falls back to `eval` with explanatory message |

Default is `close`. Solo mode is fully hands-off by default. Fleet mode goes as far as eval, which is the furthest it can go without manual winner selection.

Fleet `--stop-after=close` requires a future `aigon feature-select-winner <id> <agent>` CLI command that lets the eval agent record the winner in the engine snapshot. Once that exists, the AutoConductor checks `snapshot.winnerAgentId` and proceeds to close.

### 5. Remove `feature-autopilot`

`feature-autopilot` is removed entirely — the command handler, the `afap` skill shortcut, and all references in docs and templates. `feature-autonomous-start` is the replacement. No compatibility wrapper.

## Dependencies

- Feature 213 — `auto` tmux session role (must land first)
- `lib/commands/feature.js` — `feature-autonomous-start` command, remove `feature-autopilot` handler, AutoConductor loop
- `lib/worktree.js` — `buildTmuxSessionName` with `role: 'auto'`
- `lib/dashboard-status-helpers.js` — extend tmux session check for `auto` role
- `lib/dashboard-server.js` — new `/api/features/:id/run` spawn endpoint, `Start Autonomously` action dispatch
- `lib/action-command-mapper.js` — `Start Autonomously` action wiring
- `templates/dashboard/js/actions.js` — dashboard action definition
- `templates/dashboard/index.html` or modular equivalent — `Start Autonomously` modal UI
- `docs/development_workflow.md` — update to reflect new autonomous flow

## Out of Scope

- Server orchestration of autonomous stages
- `automation.json` or any new persistent file format
- Fleet `--stop-after=close` (requires `feature-select-winner` CLI command — separate feature)
- `deploy: auto`
- Research autonomous execution
- Automatic retry on failure

## Open Questions

- Should the `status` subcommand remain under `feature-autonomous-start status <id>`, or should it be a separate `feature-autonomous-status <id>` command for clarity?

## Future extensions

**Fleet end-to-end close**: blocked on `aigon feature-select-winner <id> <agent>` CLI command that emits `winner.selected` into the engine. Once that exists: eval agent prompt is updated to call it as its final step; AutoConductor checks `snapshot.winnerAgentId !== null` after eval and proceeds to `feature-close`. Fleet mode becomes fully hands-off end-to-end.

**Review stage**: `implement → review → close` is a natural AutoConductor sequence. The AutoConductor loop already supports arbitrary stage sequences — adding review is a new case that invokes `aigon feature-review <id> --agent=<reviewer>` when implementation is complete, waits for the review to finish in the engine snapshot, then proceeds to close. No architectural changes needed.

## Related

- Feature 212: fix-autopilot-to-use-workflow-core-engine — ✅ Done (prerequisite)
- Feature 213: standardise-tmux-session-naming-with-explicit-role-prefix — prerequisite
- `lib/worktree.js` — session naming
- `lib/dashboard-status-helpers.js` — tmux session liveness
