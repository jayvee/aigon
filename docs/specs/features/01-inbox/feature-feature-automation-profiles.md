# Feature: feature automation profiles

## Summary

Replace the current vague `feature-autopilot` model with a clearer, stage-based autonomous execution system attached directly to each feature. User-facing UX should talk about starting a feature autonomously, not configuring "automation." Internally, each feature gets an adjacent profile file that declares which stages are autonomous, skipped, or manual, and which agent(s) are assigned to those stages. The AIGON server becomes the orchestration owner for advancing the feature through those stages using workflow-core state as authority. This makes dashboard and CLI behavior consistent, allows explicit evaluator selection, and includes `deploy` as a first-class stage from the start.

**Important constraint**: The AIGON server currently never mutates engine state directly (it is read-only on workflow-core). This feature deliberately relaxes that constraint for the orchestration sweep only: the server may invoke CLI commands (e.g. `feature-eval`) when workflow-core guards permit, but it must never write workflow-core state directly. The new boundary is: the server invokes commands, commands update the engine.

**Dependency ordering**: This feature builds on feature-212 (fix autopilot to use workflow-core engine). Feature-212 should be completed first, or this feature must subsume its fixes.

## User Stories

- [ ] As a developer running a feature from the dashboard or CLI, I can choose how far a feature runs autonomously instead of relying on an ambiguous "autopilot" label.
- [ ] As a user starting automated implementation, I can explicitly choose the implementation agents and the evaluator agent, rather than hoping the system picks one implicitly.
- [ ] As a maintainer, I have one durable place to read and write feature automation policy, instead of splitting orchestration state across CLI processes, tmux sessions, and dashboard assumptions.
- [ ] As a team using AIGON server, I can restart the server and still have feature automation resume correctly from feature state, without depending on one previously launched `feature-autopilot` process still being alive.

## Acceptance Criteria

### Automation profile file

- [ ] Each feature can have an adjacent autonomous execution profile at `.aigon/workflows/features/<id>/automation.json`
- [ ] The profile supports stages: `implement`, `review`, `eval`, `close`, `deploy`
- [ ] Each stage supports modes: `auto`, `manual`, `skip`
- [ ] The `implement` stage supports multiple agents
- [ ] The `eval` stage supports an explicitly selected single evaluator agent
- [ ] The `deploy` stage is part of the model even when the repo has no deploy command configured (mode defaults to `manual`; `auto` fails validation at profile creation time if no deploy command is configured)
- [ ] The profile includes a `status` field with valid values: `pending`, `active`, `paused`, `completed`, `failed`
- [ ] Profile reads and writes are atomic (no partial writes visible to the server sweep)
- [ ] A new `lib/automation-profile.js` module owns all profile I/O; no other module reads/writes `automation.json` directly

### Server orchestration sweep

- [ ] The AIGON server poll loop (`pollStatus`) detects features with an active automation profile
- [ ] For each such feature, the server reads workflow-core state and determines which stage is eligible to advance based on the profile and workflow-core guards
- [ ] The server invokes the matching CLI command only when workflow-core confirms prerequisites are satisfied (e.g. `allAgentsReady` guard before triggering eval)
- [ ] The server never writes workflow-core state directly; it only invokes commands that go through the engine
- [ ] If a stage command fails, the server sets the profile `status` to `failed`, writes the error into the profile, and stops advancing — it does not retry automatically
- [ ] A server restart during autonomous execution correctly resumes from the current workflow-core state (no lost automation intent)
- [ ] Two features can run autonomous execution simultaneously with different profiles without interfering

### Dashboard UX

- [ ] Backlog features surface a `Start Autonomously` primary action
- [ ] Clicking `Start Autonomously` opens a modal titled `Start Feature Autonomously` that makes stage boundaries explicit: who implements, who evaluates, and where autonomy stops
- [ ] The modal includes explicit evaluator agent selection
- [ ] Dashboard-triggered autonomous runs write the same `automation.json` profile as CLI-triggered runs and use the same server orchestration path
- [ ] The dashboard no longer implies that "autopilot" means fully autonomous merge/close unless `close: auto` is explicitly configured
- [ ] A feature running autonomously shows a `Running autonomously` status indicator; a failed automation shows a `Automation failed` state with the error visible

### CLI

- [ ] A primary CLI command `aigon feature-run <id> <implement-agents...> [--eval-agent=<agent>] [--stop-after=<stage>]` writes an automation profile and signals the server to begin orchestration
- [ ] `--stop-after` defaults to `eval` if not specified (safe default: no automatic close or deploy)
- [ ] `aigon feature-autopilot` is retained as a compatibility wrapper that maps its arguments to `feature-run` and writes an automation profile
- [ ] `aigon feature-run <id> status` prints the current automation profile status
- [ ] `aigon feature-run <id> pause` sets profile status to `paused`, halting further server advancement
- [ ] `aigon feature-run <id> resume` sets profile status to `active`, re-enabling server advancement

### Regression safety

- [ ] Existing non-autonomous feature flows (feature-start, feature-do, feature-eval, feature-close without a profile) are unaffected
- [ ] `npm test` passes
- [ ] `node -c` on all modified files passes

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/dashboard-server.js
node -c lib/automation-profile.js
node -c lib/workflow-snapshot-adapter.js
node -c lib/action-command-mapper.js
node -c lib/feature-workflow-rules.js
npm test
```

Manual validation:

- Start a backlog feature from the dashboard with:
  - `implement: auto` using two agents
  - `eval: auto` using one evaluator
  - `close: manual`
  - `deploy: manual`
- Confirm the feature advances through implementation and evaluation without a human invoking `feature-eval`
- Confirm the feature stops after evaluation in a clear "ready to close" state
- Confirm a server restart during autonomous execution resumes correctly from workflow-core state
- Confirm a second feature can run a different automation profile simultaneously
- Confirm a non-automated feature running alongside is unaffected
- Confirm `aigon feature-autopilot <id> cc gg` still works via the compatibility wrapper

## Technical Approach

### 1. New `lib/automation-profile.js` module

All profile I/O lives here. Responsible for:
- `readProfile(mainRepo, featureId)` — read and parse `automation.json`; return null if absent
- `writeProfile(mainRepo, featureId, profile)` — atomic write (write to `.tmp`, rename)
- `createProfile(mainRepo, featureId, stages, source)` — create a fresh profile with `status: 'pending'`
- `setStatus(mainRepo, featureId, status, error?)` — update status field atomically

Profile schema:

```json
{
  "enabled": true,
  "status": "active",
  "stages": {
    "implement": { "mode": "auto", "agents": ["cc", "cx"] },
    "review":    { "mode": "skip" },
    "eval":      { "mode": "auto", "agent": "gg" },
    "close":     { "mode": "manual" },
    "deploy":    { "mode": "manual" }
  },
  "error": null,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "createdBy": "dashboard|cli"
}
```

Valid `status` values: `pending`, `active`, `paused`, `completed`, `failed`.

### 2. Server orchestration sweep

Add an `automationSweep()` function called from the existing `pollStatus` loop (or on its own interval — to be decided, but reuse the existing poll infrastructure rather than adding a new `setInterval`). The sweep:

1. Scans all known features across all repos for an active `automation.json`
2. For each active profile, reads workflow-core snapshot
3. Determines the current eligible stage based on profile + snapshot
4. Checks workflow-core guards (e.g. `allAgentsReady`, `canEval`) before invoking anything
5. Invokes the matching CLI command via `selfCommands` (not shell exec)
6. On error: sets profile status to `failed`, writes error, stops

The server must not advance a stage if the profile status is `paused` or `failed`.

### 3. CLI: `aigon feature-run`

Primary command replacing `feature-autopilot`:

```
aigon feature-run <id> <agents...> [--eval-agent=<agent>] [--stop-after=implement|eval|close|deploy]
```

- Calls `feature-start` if worktrees don't exist
- Writes `automation.json` with the requested profile
- Sets `status: active` and exits — the server handles the rest
- No long-running poll loop in the CLI process

Subcommands: `status`, `pause`, `resume`.

Compatibility wrapper: `aigon feature-autopilot` maps to `feature-run` with `--stop-after=eval` default.

### 4. Dashboard modal

The `Start Autonomously` modal should present:
- Agent multi-select for implementation
- Single agent select for evaluation
- `Stop after` selector: `implement` | `eval` | `close` | `deploy`
- Clear summary: "Aigon will implement with [agents], evaluate with [agent], and stop after [stage]"

On submit, POST to a new API endpoint (e.g. `POST /api/features/:id/run`) that writes the profile and returns the current status.

### 5. Resolve `review` stage

`review` is included in the model with `mode: skip` as the safe default. The server does not attempt to orchestrate `review: auto` in this feature — it logs a warning and treats it as `manual`. Full `review: auto` support is a follow-on once the review workflow is cleanly modelled end-to-end.

### 6. Deploy stage

`deploy: auto` is validated at profile creation: if the repo has no deploy command configured (check `.aigon/config.json` or equivalent), the CLI and dashboard reject `deploy: auto` with a clear error. `deploy: manual` is always allowed. The deploy stage hook itself (what command to run) is out of scope — this feature only adds `deploy` to the profile model and validates it.

### 7. Constraint: server invokes commands, not state

The server never calls `wf.emitEvent()` or writes to workflow-core directly. It only calls `selfCommands['feature-eval'](...)` etc., which go through the normal command path and engine. This preserves the single-writer contract for workflow-core.

## Dependencies

- `lib/automation-profile.js` — new module (profile I/O)
- `lib/commands/feature.js` — `feature-run` command, `feature-autopilot` compatibility wrapper
- `lib/dashboard-server.js` — orchestration sweep in poll loop, new `/api/features/:id/run` endpoint
- `lib/feature-workflow-rules.js` — guard checks before stage advancement
- `lib/workflow-snapshot-adapter.js` — snapshot reading in sweep
- `lib/action-command-mapper.js` — dashboard action wiring for `Start Autonomously`
- `lib/supervisor.js` — observe-only, no changes needed; orchestration is in dashboard-server
- `templates/dashboard/js/actions.js` — `Start Autonomously` action
- `templates/dashboard/index.html` or modular equivalent — automation modal UI
- `docs/development_workflow.md` — update to reflect new autonomous flow
- `docs/architecture.md` — document `lib/automation-profile.js`

## Out of Scope

- Rebuilding research automation in the same feature
- Fully autonomous merge/adopt by default
- Replacing workflow-core as the lifecycle authority
- `review: auto` full implementation (model it, but don't orchestrate it)
- Deploy command configuration (what command to run for deploy)
- Solving every legacy `feature-autopilot` implementation quirk — a compatibility wrapper is sufficient

## Open Questions

- Should `automationSweep()` run on the same 10s `pollStatus` interval, or on a separate longer interval (e.g. 30s) to reduce noise in the log?
- Should `deploy: auto` require `close: auto` as a prerequisite, or can deploy run while close remains manual (e.g. for repos where deploy and close are separate steps)?
- Should the primary CLI be `feature-run` or `feature-auto` (shorter, consistent with `feature-do`, `feature-eval`)?

## Related

- Feature 212: fix-autopilot-to-use-workflow-core-engine (prerequisite or subsumed)
- Feature: remove-feature-submit-and-enforce-feature-do-submission
- `docs/development_workflow.md`
- `docs/architecture.md`
- `lib/supervisor.js` — current observe-only server monitoring
- `lib/workflow-core/` — engine, machine, guards
