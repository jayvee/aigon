---
aigon_id: F675
complexity: very-high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-13T14:07:49.694Z", actor: "cli/feature-prioritise" }
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
- `lib/workflow-read-model.js` chains post-derivation merges via `appendFeatureAutonomousDashboardActions`, `appendFeatureReviewRecoveryDashboardActions`, and `appendQuotaPausedDashboardActions` (`lib/quota-dashboard-actions.js`).
- `lib/close-readiness.js`, `lib/card-headline.js`, and `lib/card-presentation.js` derive separate presentation DTOs from overlapping snapshot/fact inputs.
- `templates/dashboard/js/actions.js` filters actions by lifecycle/session heuristics (`evalRunning`, `pendingSpecReviews`, `closeReadiness.primaryBlocker`, `cardPresentation.severity`) and chooses the primary button client-side; card renderers consume those DTOs independently.
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
  contractVersion: 1,
  entity: { id, displayKey, name },
  state: { lifecycle, phase, lane, label, severity },
  presentation: {
    headline,
    contextLine,
    timeline,
    agentSummary,
    closeReadiness
  },
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

`presentation` replaces the parallel `cardHeadline` / `cardPresentation` / `closeReadiness` fields on feature rows — all three are projected from the same definition and runtime facts, not derived in separate modules with independent precedence rules. Follow F650 headline/action separation: presentation answers *what is happening*; `decisions`/`tools` answer *what the operator may do*.

The contract must distinguish workflow decisions from observation/session tools. It must expose at most one primary action and contain explicit alternatives rather than synthesizing a single next stage. Disabled actions may be included only when the same definition provides a stable unavailable reason; otherwise unavailable actions remain absent.

### 5. Current dashboard consumes the contract

The existing dashboard must render feature cards from the new contract without a visual redesign. Existing controls, modals, confirmations, action handlers, and card density should remain behaviorally compatible.

Frontend code may dispatch an action or open the interaction surface named by the contract. It must not:

- derive action eligibility from lifecycle, stage, agents, sessions, or filenames;
- choose the primary action (remove client-side primary selection in `renderActionButtons` — today driven by `closeReadiness.primaryBlocker`, `evalPickWinner`, `cardPresentation.severity`, and `priority === 'high'`);
- filter actions by eval/session/spec-review heuristics before render;
- reclassify workflow decisions as tools or vice versa;
- replace, inject, demote, or suppress server actions;
- infer a next stage or assignment;
- use action-specific conditions to decide visibility.

Temporary compatibility fields such as `validActions`, `cardHeadline`, `cardPresentation`, and `closeReadiness` may remain for non-dashboard consumers during migration, but the feature dashboard must consume the versioned contract and compatibility output must be generated from the same projector. Any new contract field that affects card repaint must be added to `computeStatusFingerprint` in `lib/dashboard-status-version.js`.

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

- [ ] `/api/status` exposes `uiContract` (or equivalent) on every non-lean feature row in `lib/dashboard-collect/feature-poll.js`; contract changes that affect card repaint bump `computeStatusFingerprint`.
- [ ] `lib/card-headline.js`, `lib/card-presentation.js`, and `lib/close-readiness.js` become thin compatibility projections from the unified projector (or are inlined into it) with no independent eligibility/precedence logic.
- [ ] The current feature pipeline (`templates/dashboard/js/pipeline.js`, `card-presentation.js`, `actions.js`) renders state, primary/secondary actions, tools, blockers, drag targets, and interaction requirements from that contract.
- [ ] The browser does not contain feature action eligibility, ranking, or suppression rules; action-specific execution adapters are allowed only after the server has exposed the action.
- [ ] `lib/dashboard-actions/` and `POST /api/action` route execution through a shared gateway that rehydrates the latest aggregate/runtime facts and revalidates `{ actionId, payload }` against the same machine definition immediately before dispatch.
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

### Phase 0 — characterization (no behavior change)

1. Add characterization coverage for the current state/action matrix before moving code. Include the live motivating combination: `implementing` + solo ready agent. Snapshot today's `validActions`, `cardHeadline`, and `closeReadiness` per scenario as golden fixtures.

### Phase 1 — definition + projector (server-only)

2. Introduce a small declarative workflow/action DSL in or beside `lib/workflow-core/` (e.g. `lib/workflow-core/interaction-definition.js`). Compile the XState state config and action descriptors from the same definitions rather than maintaining parallel tables in `lib/feature-workflow-rules.js`.
3. Define a normalized runtime-facts schema (`lib/workflow-core/runtime-facts.js` or equivalent) and move ephemeral eligibility predicates into named machine guards.
4. Add machine metadata for lane, phase, state label, and severity. Generate `LIFECYCLE_TO_STAGE` compatibility from this metadata during migration.
5. Add the versioned UI-contract projector (`lib/feature-ui-contract.js` or under `lib/workflow-core/`). Keep it pure: one aggregate, one runtime-facts object, no I/O, no post-projection mutation. Fold headline/presentation/close-readiness into `presentation`.

**Exit:** projector output matches Phase 0 golden fixtures for all required scenarios; existing integration tests still pass with compatibility shims.

### Phase 2 — eliminate post-injection (server-only)

6. Represent action-only operations as guarded internal/root transitions or orthogonal-region events. Replace `bypassMachine` candidates and post-processing injectors one category at a time (`quota-dashboard-actions`, `feature-autonomous-dashboard-actions`, review-recovery helpers in `workflow-read-model.js`).
7. Wire `feature-poll.js` to attach `uiContract` and generate legacy fields from the projector.

**Exit:** no feature action appenders remain after base derivation; `bypassMachine` count for features is zero.

### Phase 3 — dashboard consumption + execution gateway

8. Add the action execution gateway shared by `lib/dashboard-actions/` and `lib/dashboard-action-command.js`.
9. Adapt the current dashboard to render the contract while retaining its current DOM and styling. Keep interaction-surface adapters in `templates/dashboard/js/actions/` generic and driven by contract metadata only.

**Exit:** `actions.js` contains no feature eligibility, filtering, or primary-selection logic; browser smoke (`npm run test:browser:smoke`) passes.

### Phase 4 — cleanup + generated verification

10. Remove obsolete feature stage rules, action mappings, injectors, and frontend eligibility/priority logic once all callers use the new definition.
11. Generate state/action documentation and scenario fixtures from the completed definition.

Prefer a composed definition over a monolithic machine with a state for every cross-product. Keep workflow-core pure and pass runtime facts into it; collectors remain responsible only for normalized observation. Preserve the repo boundary: no Pro implementation or internal-only workflow may enter OSS. Research cards may reuse shared DSL/projector infrastructure later but are not migrated in this feature.

## Validation

Per-phase: `npm run test:iterate` after each commit touching `lib/` or dashboard JS.

Before `implementation-complete` / push:

```bash
npm run test:deploy
node -c aigon-cli.js
```

Deploy gate includes lint, integration/workflow tests, dashboard browser smoke, and test-budget check. Full Playwright (`npm run test:browser:full`) is release-triage only unless a phase explicitly changes cross-browser behavior.

Targeted regression files for this feature:

```bash
npx playwright test --config tests/dashboard-e2e/playwright.config.js state-consistency.spec.js critical-actions.spec.js keyed-card-render.spec.js close-failure-event.spec.js
node tests/integration/workflow-read-model.test.js
node tests/integration/lifecycle.test.js
```

## Dependencies

- None. This is the prerequisite for the later dashboard visual redesign feature.

## Out of Scope

- The proposed dashboard visual redesign, elastic lanes, compact replacement card, or new visual language.
- Changing feature lifecycle policy merely to simplify rendering.
- Migrating research, feedback, or feature-set cards to the new contract (research's parallel `appendQuotaPausedDashboardActions` / recovery path in `workflow-read-model.js` stays unchanged; shared DSL modules may be entity-agnostic but consumers ship in a follow-up).
- Moving Pro implementation or internal release workflows into OSS.
- Treating local component state such as expanded history, hover, focus, or open popovers as domain workflow state.

## Open Questions

- None. Implementation may choose the concrete DSL/module boundaries, but the single-definition, no-post-injection, server-derived-contract, and current-UI-compatibility constraints are required.

## Pre-authorised

- test-budget-ceiling — model-based matrix generation and golden fixture expansion may require a one-time ceiling bump with net test deletion elsewhere
- skip-full-browser-mid-iteration — use `test:iterate` / smoke subset between phases; full browser suite only at phase boundaries

## Related

- Dashboard UX proposal: `docs/proposals/dash-ux-codex/`
- Card design contract (F650): `docs/dashboard-card-design.md`, `docs/card-design-wireframe.html`
- Workflow rules: `lib/feature-workflow-rules.js`
- Machine/action derivation: `lib/workflow-core/machine.js`, `lib/workflow-core/actions.js`
- Dashboard projection: `lib/workflow-snapshot-adapter.js`, `lib/workflow-read-model.js`, `lib/read-model/entity-view.js`
- Presentation helpers: `lib/card-headline.js`, `lib/card-presentation.js`, `lib/close-readiness.js`, `lib/state-render-meta.js`
- Post-injection helpers: `lib/quota-dashboard-actions.js`, `lib/feature-autonomous-dashboard-actions.js`
- Status fingerprint: `lib/dashboard-status-version.js`
- Current frontend action rendering: `templates/dashboard/js/actions.js`, `templates/dashboard/js/pipeline.js`, `templates/dashboard/js/card-presentation.js`
