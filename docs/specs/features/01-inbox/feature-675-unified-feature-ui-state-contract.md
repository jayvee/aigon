---
aigon_id: F675
complexity: very-high
---

# Feature: unified-feature-ui-state-contract

## Summary

Make the composed feature state machine the single executable source of truth for the current dashboard's feature state, available decisions, cross-cutting controls, action priority, board lane, blockers, and interaction requirements. Replace the fragmented combination of lifecycle transitions, separate stage rules, `bypassMachine` candidates, snapshot-adapter mappings, post-derivation dashboard injectors, and frontend action interpretation with one declarative feature interaction definition that compiles the machine, action catalog, command validation, and a versioned UI contract.

This is an architectural migration, not a dashboard redesign. The existing dashboard must retain its current layout and behavior while consuming the new contract. A later feature will use this stable contract to implement the proposed dashboard design.

## Problem Statement

Feature workflow truth is currently distributed across several independently editable layers:

- `lib/feature-workflow-rules.js` defines engine states, transitions, action candidates, `bypassMachine` candidates, and a separate stage-oriented action table.
- `lib/workflow-snapshot-adapter.js` maps only selected machine actions into dashboard action DTOs and separately maps lifecycle states to board lanes.
- `lib/state-queries.js` contains another stage/action derivation path.
- `lib/workflow-read-model.js` and focused helpers append quota, escalation, autonomous, recovery, failover, and other actions after the base action derivation has completed.
- `templates/dashboard/js/actions.js` and card renderers rank, suppress, group, and relabel actions in the browser.
- Dashboard scenario tests frequently hand-author `validActions`, so they can exercise combinations that are not produced by the real machine and can omit combinations that are.

This fragmentation permits machine transitions without dashboard descriptors, dashboard actions without machine ownership, conflicting state and stage rules, multiple definitions of priority, and UI copy that invents a single "next" step where the workflow actually offers choices.

The motivating concrete state is a solo feature whose agent has completed implementation while the persisted lifecycle remains `implementing`. Its authoritative choices are Close and optional Code Review, alongside non-decision tools such as Open Terminal, Push, Nudge, and Reset. The UI contract must represent that choice directly and must never infer a mandatory review assignment.

## User Stories

- [ ] As an operator, I see every action the feature workflow currently permits, with the machine-recommended primary decision visible and optional alternatives still discoverable.
- [ ] As an operator, I never see a fabricated next stage, missing Close action, or mandatory-review implication when review is optional.
- [ ] As a dashboard developer, I render a versioned server contract instead of reconstructing workflow meaning from lifecycle names, agent rows, sessions, or action identifiers.
- [ ] As a workflow developer, I add or change an action once and receive the machine transition, UI metadata, command validation, generated documentation, and test coverage from the same declaration.
- [ ] As a maintainer, I can enumerate every reachable feature state and action combination from executable definitions rather than maintaining a handwritten inventory.

## Architectural Contract

### 1. One declarative feature interaction definition

Introduce one feature interaction definition or DSL that owns, for every operator-visible action:

- stable action ID and event type;
- event payload/schema and scope (`feature`, `agent`, or other declared scope);
- state-machine transition or guarded action-only/internal transition;
- guard and unavailable reason;
- execution handler or client interaction surface;
- board/lifecycle effect when applicable;
- label, intent, group, ordering, and confirmation metadata;
- required input such as agent picker, escalation reason, or confirmation;
- whether the action is a workflow decision, recovery action, agent control, view, or tool.

The XState machine and UI action catalog must be compiled from this definition. It must be impossible to add a machine action without a dashboard descriptor or to expose a dashboard action that the composed machine cannot validate.

### 2. Composed statechart, not one combinatorial lifecycle enum

Preserve the durable feature lifecycle semantics while representing orthogonal concerns through composed or parallel regions and parameterized agent actors where appropriate:

- lifecycle and board progression;
- spec review/revision;
- code review/revision;
- evaluation and winner selection;
- close and close recovery;
- autonomous-controller state;
- per-agent execution, session, quota, failure, and failover state.

Cross-cutting actions such as Open Terminal, Nudge, Resume after quota, Drop Agent, Stop Automation, Resolve Close, or Reconcile Spec must be ordinary guarded machine actions. They must not rely on `bypassMachine` or be appended to the result after action derivation.

The implementation may deliver this composition incrementally, but the completed feature must have a single public derivation path and no feature action injectors after that path.

### 3. Explicit immutable runtime facts

Define and validate a versioned runtime-facts input containing the ephemeral information that the durable workflow snapshot cannot discover itself, including:

- normalized agents and session liveness;
- quota and failover availability;
- autonomous-controller state;
- dev-server availability;
- leases and spec drift;
- evaluation sessions/results;
- close failures/readiness;
- review escalations;
- registered extension facts.

The interaction machine evaluates actions from `{ aggregate, runtimeFacts }`. Runtime collectors may gather facts, but they may not decide action eligibility or mutate the resulting contract.

### 4. Versioned feature UI contract

Project the composed machine into a versioned DTO with at least:

```js
{
  contractVersion,
  entity: { id, displayKey, name },
  state: { lifecycle, phase, lane, label, severity },
  decisions: {
    primaryActionId,
    actions: []
  },
  tools: [],
  blockers: [],
  allowedDrops: [],
  history: [],
  agents: [],
  sessions: []
}
```

The contract must distinguish workflow decisions from observation/session tools. It must expose at most one primary action and contain explicit alternatives rather than synthesizing a single next stage. Disabled actions may be included only when the same definition provides a stable unavailable reason; otherwise unavailable actions remain absent.

### 5. Current dashboard consumes the contract

The existing dashboard must render feature cards from the new contract without a visual redesign. Existing controls, modals, confirmations, action handlers, and card density should remain behaviorally compatible.

Frontend code may dispatch an action or open the interaction surface named by the contract. It must not:

- derive action eligibility from lifecycle, stage, agents, sessions, or filenames;
- choose the primary action;
- reclassify workflow decisions as tools or vice versa;
- replace, inject, demote, or suppress server actions;
- infer a next stage or assignment;
- use action-specific conditions to decide visibility.

Temporary compatibility fields such as `validActions` may remain for non-dashboard consumers during migration, but the feature dashboard must consume the versioned contract and compatibility output must be generated from the same definition.

### 6. Extension boundary

OSS and registered extensions must contribute actions before the machine/contract is compiled or evaluated through a documented registration API. Pro/failover integrations must not mutate `validActions` after derivation. An extension action must provide the same event, guard, handler, UI metadata, and completeness guarantees as an OSS action.

## Acceptance Criteria

### Single source of truth

- [ ] One exported feature interaction definition is the canonical source for engine transitions, operator-visible actions, UI action metadata, board lane metadata, and action execution requirements.
- [ ] `FEATURE_STAGE_TRANSITIONS` / `FEATURE_STAGE_ACTIONS` and the feature path in `lib/state-queries.js` are removed or reduced to generated compatibility projections; they contain no independently maintained feature eligibility rules.
- [ ] Feature action derivation no longer uses `bypassMachine`.
- [ ] Quota, escalation, autonomous, review-recovery, close-recovery, failover, session, infra, and view actions are evaluated through the composed machine contract rather than appended afterward.
- [ ] Lifecycle-to-board-lane mapping is machine metadata or generated from it; `LIFECYCLE_TO_STAGE` is not an independent feature mapping.
- [ ] Every operator-visible feature action has a registered execution/client handler and UI descriptor, and every registered descriptor is reachable or explicitly marked internal.
- [ ] Existing unmapped candidates such as Another Review Cycle and Proceed are either correctly exposed through the contract or deliberately removed with tests documenting the replacement workflow.
- [ ] The conflicting Continue Evaluation and post-start Pause definitions are resolved to one documented behavior, preserving the intended current workflow unless a behavior change is separately justified and tested.

### UI contract and current behavior

- [ ] `/api/status` or a focused feature endpoint exposes the versioned feature UI contract for every non-lean feature row required by the pipeline.
- [ ] The current feature pipeline renders state, primary/secondary actions, tools, blockers, drag targets, and interaction requirements from that contract.
- [ ] The browser does not contain feature action eligibility, ranking, or suppression rules; action-specific execution adapters are allowed only after the server has exposed the action.
- [ ] The server rehydrates the latest aggregate/runtime facts and revalidates the requested action against the same machine definition immediately before execution.
- [ ] Existing feature dashboard workflows remain available: prioritise, unprioritise, start, autonomous start, schedule, spec review/revision, implementation/session control, optional code review, revision, fleet evaluation/winner selection, close, close recovery, pause/resume where currently supported, reset/delete, quota/failover, escalation disposition, autonomous recovery, spec reconciliation, and view actions.
- [ ] Existing dashboard layout, styling, terminology, modals, and interaction behavior remain materially unchanged except where required to stop hiding or misrepresenting an authoritative action.
- [ ] The contract invariant permits zero or one `primaryActionId`; the server must reject or fail tests on multiple primary decisions.

### Required state scenarios

- [ ] A solo feature with lifecycle `implementing` and one ready agent emits Close as the primary decision, Code Review as an optional decision, and Open Terminal/Push/Nudge/Reset in their declared non-primary groups when their guards pass.
- [ ] The ready-solo scenario contains no inferred reviewer, `Not assigned`, or mandatory review step.
- [ ] A fleet feature with all agents ready emits Evaluate as the primary decision and does not emit solo Close or Code Review choices.
- [ ] Evaluation exposes winner selection only for eligible ready agents and exposes Close only after winner selection permits it.
- [ ] Code review approved, changes requested, code revision, another-cycle, proceed, cancellation, and direct-close paths are covered.
- [ ] Spec review/revision, paused pre-start, quota paused, failed/lost session, autonomous stopped/failed, escalation blocking/advisory, merge conflict, post-merge gate, pre-authorisation failure, close recovery, closing, and done states are covered.
- [ ] `done` exposes no lifecycle/session mutation actions through the normal feature contract.

### Generated verification

- [ ] Model-based tests traverse reachable machine states and representative runtime-fact combinations to generate an authoritative state/action matrix.
- [ ] A generated artifact documents each state, action, guard, interaction requirement, handler, and UI group from the executable definition.
- [ ] Tests fail when an action lacks a descriptor, handler, guard explanation, or reachable scenario.
- [ ] Tests fail when dashboard code attempts to append actions after contract derivation or contains feature action visibility/priority logic.
- [ ] Dashboard scenario fixtures are generated from the contract or built through supported machine events; feature tests do not hand-author arbitrary `validActions` arrays except isolated renderer-unit tests explicitly validating malformed input.
- [ ] Existing lifecycle, workflow-read-model, dashboard action, close/recovery, quota, escalation, autonomous, state-consistency, critical-action, and keyed-render tests pass.

## Technical Approach

1. Add characterization coverage for the current state/action matrix before moving code. Include the live motivating combination: `implementing` + solo ready agent.
2. Introduce a small declarative workflow/action DSL in or beside `lib/workflow-core/`. Compile the XState state config and action descriptors from the same definitions rather than maintaining parallel tables.
3. Define a normalized runtime-facts schema and move ephemeral eligibility predicates into named machine guards.
4. Represent action-only operations as guarded internal/root transitions or orthogonal-region events. Replace `bypassMachine` candidates and post-processing injectors one category at a time.
5. Add machine metadata for lane, phase, state label, and severity. Generate compatibility mappings from this metadata during migration.
6. Add the versioned UI-contract projector. Keep it pure: one aggregate, one runtime-facts object, no I/O, no post-projection mutation.
7. Add an action execution gateway that validates `{ actionId, payload }` against a freshly derived contract before dispatching the registered handler.
8. Adapt the current dashboard to render the contract while retaining its current DOM and styling. Keep interaction-surface adapters generic and driven by contract metadata.
9. Remove obsolete feature stage rules, action mappings, injectors, and frontend eligibility/priority logic once all callers use the new definition.
10. Generate state/action documentation and scenario fixtures from the completed definition.

Prefer a composed definition over a monolithic machine with a state for every cross-product. Keep workflow-core pure and pass runtime facts into it; collectors remain responsible only for normalized observation. Preserve the repo boundary: no Pro implementation or internal-only workflow may enter OSS.

## Validation

```bash
npm test
npm run lint
npx playwright test --config tests/dashboard-e2e/playwright.config.js state-consistency.spec.js critical-actions.spec.js keyed-card-render.spec.js close-failure-event.spec.js
node -c aigon-cli.js
```

## Dependencies

- None. This is the prerequisite for the later dashboard visual redesign feature.

## Out of Scope

- The proposed dashboard visual redesign, elastic lanes, compact replacement card, or new visual language.
- Changing feature lifecycle policy merely to simplify rendering.
- Redesigning research, feedback, or feature-set cards, except for shared infrastructure required to avoid a feature-only dead end.
- Moving Pro implementation or internal release workflows into OSS.
- Treating local component state such as expanded history, hover, focus, or open popovers as domain workflow state.

## Open Questions

- None. Implementation may choose the concrete DSL/module boundaries, but the single-definition, no-post-injection, server-derived-contract, and current-UI-compatibility constraints are required.

## Related

- Dashboard UX proposal: `docs/proposals/dash-ux-codex/`
- Workflow rules: `lib/feature-workflow-rules.js`
- Machine/action derivation: `lib/workflow-core/machine.js`, `lib/workflow-core/actions.js`
- Dashboard projection: `lib/workflow-snapshot-adapter.js`, `lib/workflow-read-model.js`
- Current frontend action rendering: `templates/dashboard/js/actions.js`, `templates/dashboard/js/pipeline.js`
