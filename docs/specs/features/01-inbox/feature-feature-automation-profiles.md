# Feature: feature automation profiles

## Summary

Replace the current vague `feature-autopilot` model with a clearer, stage-based automation system attached directly to each feature. Instead of a long-running CLI loop that tries to own implementation and optionally eval, each feature gets an adjacent automation profile file that declares which stages are automated, skipped, or manual, and which agent(s) are assigned to those stages. The AIGON server becomes the orchestration owner for advancing the feature through those stages using workflow-core state as authority. This makes dashboard and CLI behavior consistent, allows explicit evaluator selection, and includes `deploy` as a first-class stage from the start.

## User Stories

- [ ] As a developer running a feature from the dashboard or CLI, I can choose which stages are automated instead of relying on an ambiguous "autopilot" label.
- [ ] As a user starting automated implementation, I can explicitly choose the implementation agents and the evaluator agent, rather than hoping the system picks one implicitly.
- [ ] As a maintainer, I have one durable place to read and write feature automation policy, instead of splitting orchestration state across CLI processes, tmux sessions, and dashboard assumptions.
- [ ] As a team using AIGON server, I can restart the server and still have feature automation resume correctly from feature state, without depending on one previously launched `feature-autopilot` process still being alive.

## Acceptance Criteria

- [ ] Each feature can have an adjacent automation profile file, stored alongside feature workflow state rather than as a separate top-level entity
- [ ] The automation profile supports these stages from day one: `implement`, `review`, `eval`, `close`, `deploy`
- [ ] Each stage supports explicit mode settings that at minimum include `manual`, `auto`, and `skip`
- [ ] The `implement` stage supports multiple agents
- [ ] The `eval` stage supports an explicitly selected single evaluator agent
- [ ] The `deploy` stage is part of the automation model even when the current repo has no deploy command configured
- [ ] The AIGON server reads the feature automation profile and advances automated stages based on workflow-core state and guards
- [ ] The server never forces invalid workflow transitions; it only invokes allowed commands when workflow-core indicates prerequisites are satisfied
- [ ] Dashboard-triggered automation and CLI-triggered automation use the same underlying feature automation profile and orchestration path
- [ ] A user can start feature automation from the dashboard by configuring automation stages instead of a bare "Run Autopilot" action
- [ ] A user can start feature automation from the CLI while explicitly setting implementation agents and evaluator agent
- [ ] If automated implementation completes and `eval` is set to `auto`, the server triggers feature evaluation without requiring a human to manually run `feature-eval`
- [ ] If `close` is set to `manual`, the automation run stops cleanly after eval and surfaces that the feature is ready for human close/adopt
- [ ] If `deploy` is set to `auto`, deployment only runs after workflow prerequisites for closing are satisfied
- [ ] Existing `feature-autopilot` users have a compatibility path: either the command writes a feature automation profile and hands off to the server, or the dashboard action is renamed while the CLI command remains as a compatibility wrapper
- [ ] The dashboard UI no longer implies that "autopilot" means fully autonomous merge/close unless that stage is explicitly configured for automation

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
- Confirm a server restart during automation does not lose the automation plan
- Confirm a second feature can use a different automation profile without global config changes

## Technical Approach

### 1. Replace "autopilot" with a feature automation profile

Store automation as adjacent metadata for each feature, for example:

` .aigon/workflows/features/<id>/automation.json `

This avoids introducing a new top-level "run" entity while still giving the server a durable place to read and write orchestration policy.

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

Move long-lived automation monitoring out of a single `feature-autopilot` CLI process and into the AIGON server. The server should:

- read workflow-core feature state
- read the adjacent automation profile
- determine which stage is currently eligible to advance
- invoke the matching command only when workflow-core state permits it
- persist status/errors back into the automation profile or related feature-local metadata

This makes automation resumable across server restarts and keeps dashboard and CLI behavior aligned.

### 3. Reframe the UX around Automation, not Autopilot

The current "Run Autopilot" label is misleading because users reasonably expect it to go end-to-end. The product should shift to an "Automation" concept where users configure stages.

Dashboard direction:

- Replace or evolve "Run Autopilot" into an "Automation" action
- Present a modal that configures per-stage behavior
- Allow explicit evaluator selection
- Make it obvious where automation stops when later stages remain manual

CLI direction:

- Keep `feature-autopilot` initially as a compatibility wrapper if needed
- Add or evolve toward a clearer CLI such as `feature-automation` or equivalent flags on `feature-autopilot`
- Allow explicit evaluator selection and stage modes in CLI input

### 4. Keep workflow-core authoritative

The automation profile is orchestration metadata, not lifecycle authority. It must never directly rewrite feature stage. It can only request valid commands when workflow-core says the feature is ready.

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
- Should the compatibility CLI remain named `feature-autopilot`, or should the user-facing CLI move to `feature-automation` immediately?

## Related

- Feature: [fix-autopilot-to-use-workflow-core-engine](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-fix-autopilot-to-use-workflow-core-engine.md)
- Feature: [remove-feature-submit-and-enforce-feature-do-submission](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-remove-feature-submit-and-enforce-feature-do-submission.md)
- [docs/development_workflow.md](/Users/jviner/src/aigon/docs/development_workflow.md)
- [docs/architecture.md](/Users/jviner/src/aigon/docs/architecture.md)
