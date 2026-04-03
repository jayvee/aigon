# Feature: feature automation profiles

## Summary

Replace the current vague `feature-autopilot` model with a clearer, stage-based autonomous execution system attached directly to each feature. User-facing UX should talk about starting a feature autonomously, not configuring "automation." Internally, each feature gets an adjacent profile file that declares which stages are autonomous, skipped, or manual, and which agent(s) are assigned to those stages. The AIGON server becomes the orchestration owner for advancing the feature through those stages using workflow-core state as authority. This makes dashboard and CLI behavior consistent, allows explicit evaluator selection, and includes `deploy` as a first-class stage from the start.

## User Stories

- [ ] As a developer running a feature from the dashboard or CLI, I can choose how far a feature runs autonomously instead of relying on an ambiguous "autopilot" label.
- [ ] As a user starting automated implementation, I can explicitly choose the implementation agents and the evaluator agent, rather than hoping the system picks one implicitly.
- [ ] As a maintainer, I have one durable place to read and write feature automation policy, instead of splitting orchestration state across CLI processes, tmux sessions, and dashboard assumptions.
- [ ] As a team using AIGON server, I can restart the server and still have feature automation resume correctly from feature state, without depending on one previously launched `feature-autopilot` process still being alive.

## Acceptance Criteria

- [ ] Each feature can have an adjacent autonomous execution profile file, stored alongside feature workflow state rather than as a separate top-level entity
- [ ] The autonomous execution profile supports these stages from day one: `implement`, `review`, `eval`, `close`, `deploy`
- [ ] Each stage supports explicit mode settings that at minimum include `manual`, `auto`, and `skip`
- [ ] The `implement` stage supports multiple agents
- [ ] The `eval` stage supports an explicitly selected single evaluator agent
- [ ] The `deploy` stage is part of the automation model even when the current repo has no deploy command configured
- [ ] The AIGON server reads the feature's autonomous execution profile and advances autonomous stages based on workflow-core state and guards
- [ ] The server never forces invalid workflow transitions; it only invokes allowed commands when workflow-core indicates prerequisites are satisfied
- [ ] Dashboard-triggered autonomous runs and CLI-triggered autonomous runs use the same underlying feature profile and orchestration path
- [ ] A user can start a backlog feature from the dashboard with a primary action labeled `Start Autonomously`
- [ ] Starting a feature autonomously opens a UI that makes stage boundaries explicit, including who implements, who evaluates, and where autonomy stops
- [ ] A user can start a feature autonomously from the CLI while explicitly setting implementation agents and evaluator agent
- [ ] If automated implementation completes and `eval` is set to `auto`, the server triggers feature evaluation without requiring a human to manually run `feature-eval`
- [ ] If `close` is set to `manual`, the automation run stops cleanly after eval and surfaces that the feature is ready for human close/adopt
- [ ] If `deploy` is set to `auto`, deployment only runs after workflow prerequisites for closing are satisfied
- [ ] Existing `feature-autopilot` users have a compatibility path: either the command writes a feature profile and hands off to the server, or the dashboard action is renamed while the CLI command remains as a compatibility wrapper
- [ ] The dashboard UI no longer implies that "autopilot" means fully autonomous merge/close unless that stage is explicitly configured for autonomous execution
- [ ] The preferred user-facing CLI naming shifts away from `autopilot` toward `autonomous`, while preserving a compatibility path for existing scripts

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/dashboard-server.js
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
- Confirm a server restart during autonomous execution does not lose the feature's execution plan
- Confirm a second feature can use a different automation profile without global config changes

## Technical Approach

### 1. Replace "autopilot" with a feature-level autonomous execution profile

Store autonomous execution settings as adjacent metadata for each feature, for example:

` .aigon/workflows/features/<id>/automation.json `

This avoids introducing a new top-level "run" entity while still giving the server a durable place to read and write stage policy.

Suggested shape:

```json
{
  "enabled": true,
  "status": "active",
  "stages": {
    "implement": {
      "mode": "auto",
      "agents": ["cc", "cx"]
    },
    "review": {
      "mode": "skip"
    },
    "eval": {
      "mode": "auto",
      "agent": "gg"
    },
    "close": {
      "mode": "manual"
    },
    "deploy": {
      "mode": "manual"
    }
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "createdBy": "dashboard|cli"
}
```

### 2. Make the server the orchestration owner

Move long-lived autonomous execution monitoring out of a single `feature-autopilot` CLI process and into the AIGON server. The server should:

- read workflow-core feature state
- read the adjacent automation profile
- determine which stage is currently eligible to advance
- invoke the matching command only when workflow-core state permits it
- persist status/errors back into the automation profile or related feature-local metadata

This makes autonomous execution resumable across server restarts and keeps dashboard and CLI behavior aligned.

### 3. Reframe the UX around Autonomous Start, not Autopilot

The current "Run Autopilot" label is misleading because users reasonably expect it to go end-to-end, and "automation" sounds like workflow-rule authoring rather than running a feature autonomously. The product should shift to an "Autonomous" concept where the user starts a feature autonomously and chooses how far down the pipeline that run should go.

Dashboard direction:

- Replace or evolve "Run Autopilot" into `Start Autonomously`
- Present a modal titled `Start Feature Autonomously`
- Make the main control about where autonomy stops, rather than exposing internal implementation jargon
- Allow explicit evaluator selection
- Make it obvious where autonomous execution stops when later stages remain manual

Recommended dashboard wording:

- Backlog action: `Start Autonomously`
- Modal title: `Start Feature Autonomously`
- Stage section: `Autonomous stages`
- Stop selector: `Stop after`
- Status copy: `Running autonomously`

CLI direction:

- Keep `feature-autopilot` initially as a compatibility wrapper if needed
- Introduce a clearer primary CLI such as `feature-autonomous-start`
- Allow explicit evaluator selection and a clear stop boundary in CLI input

Recommended CLI wording:

- Primary command: `aigon feature-autonomous-start <feature-id> <implement-agents...> --eval-agent=<agent> --stop-after=<stage>`
- Compatibility command: `aigon feature-autopilot ...` writes the same adjacent profile and hands off to the server

The key CLI model should be:

- start this feature autonomously
- choose who implements it
- choose who evaluates it
- choose where autonomy stops

### 4. Keep workflow-core authoritative

The autonomous execution profile is orchestration metadata, not lifecycle authority. It must never directly rewrite feature stage. It can only request valid commands when workflow-core says the feature is ready.

This means:

- `implement:auto` can start agents and monitor readiness
- `eval:auto` can invoke `feature-eval` only after implementation prerequisites are satisfied
- `close:auto` can invoke the close path only when evaluation state permits it
- `deploy:auto` can invoke deploy only when close/ship prerequisites are satisfied

### 5. Include deploy now

Even if deploy automation is initially thin, `deploy` should be part of the model now so the stage system does not need to be redesigned later. Repos with no deploy command configured can surface `deploy` as unavailable or fail validation when `deploy:auto` is selected.

## Dependencies

- `lib/commands/feature.js`
- `lib/dashboard-server.js`
- `lib/feature-workflow-rules.js`
- `lib/action-command-mapper.js`
- `lib/workflow-snapshot-adapter.js`
- `templates/dashboard/js/actions.js`
- `templates/dashboard/index.html` or related dashboard UI templates for automation configuration
- `docs/development_workflow.md`
- `docs/architecture.md`

## Out of Scope

- Rebuilding research automation in the same feature
- Fully autonomous merge/adopt by default
- Replacing workflow-core as the lifecycle authority
- Solving every legacy `feature-autopilot` implementation quirk in this same feature if a compatibility wrapper is sufficient during migration

## Open Questions

- Should `review` remain a distinct stage in the automation profile if the current feature workflow does not yet model it cleanly end-to-end?
- Should `deploy:auto` be allowed when `close` remains manual, or should deploy require `close:auto` as a policy rule?
- Should the primary CLI be `feature-autonomous-start`, or should Aigon use a shorter spelling such as `feature-auto-start`?

## Related

- Feature: [fix-autopilot-to-use-workflow-core-engine](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-fix-autopilot-to-use-workflow-core-engine.md)
- Feature: [remove-feature-submit-and-enforce-feature-do-submission](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-remove-feature-submit-and-enforce-feature-do-submission.md)
- [docs/development_workflow.md](/Users/jviner/src/aigon/docs/development_workflow.md)
- [docs/architecture.md](/Users/jviner/src/aigon/docs/architecture.md)
