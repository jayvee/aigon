---
aigon_id: F677
complexity: very-high
depends_on: [675]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-14T12:20:36.134Z", actor: "cli/feature-prioritise" }
---

# Feature: complete-dashboard-ui-contract-and-state-gallery

## Summary

Complete the versioned dashboard interaction contract introduced by F675 so the server alone describes every operator-visible feature, research, feature-set, session, and autonomous-run state and action. Add a checked-in living state gallery that generates representative scenarios from those executable definitions, renders them through the production dashboard card pipeline and styles, reports contract coverage gaps, and runs independently on port 3700 via `npm run gallery`.

This is the architectural prerequisite for the dashboard visual redesign. It must remove the temporary inference and hand-authored action adapters discovered while prototyping the redesign, without shipping that redesign or changing workflow policy.

## Problem Statement

F675 made the feature `uiContract` authoritative for the current feature card, but it deliberately excluded research and feature-set cards. The redesign prototype exposed additional gaps:

- feature autonomous-controller status and its past/current/future stage plan are not part of the feature contract;
- research has no versioned UI contract and still relies on independently maintained action mappings and post-derivation action injectors;
- feature sets expose a separate unversioned `validActions` payload and do not contractually describe their member plan, spec-review work, conductor state, or sessions;
- live sessions do not carry a server-owned Peek/view affordance, so a renderer must infer Peek from session liveness and rewrite Open Terminal labels;
- cross-cutting quota, failover, escalation, recovery, autonomous, and session actions are not uniformly represented across entity types;
- `feature-code-review-cycle`, `feature-proceed-after-review`, `research-code-review-cycle`, and `research-proceed-after-review` are engine candidates without complete dashboard descriptors;
- hand-authored scenario fixtures can show impossible combinations, such as evaluation for a solo run or quota-paused copy while every agent is ready;
- there is no permanent, browsable state/action inventory for validating UX changes or reviewing a newly added workflow action.

The UI must never reconstruct those semantics. Durable workflow state plus normalized runtime facts must project to a complete, versioned interaction contract, and the gallery must consume that exact projection.

## User Stories

- [ ] As an operator, I can review feature, research, set, Fleet, autonomous-run, recovery, quota, review, revision, evaluation, closing, and done cards without encountering fabricated or missing actions.
- [ ] As an operator, every live implementation, research, review, revision, evaluation, close-recovery, autonomous, or set-conductor session exposes Peek explicitly when it is available.
- [ ] As a dashboard designer, I can run `npm run gallery`, open one stable local URL, and inspect production cards across every supported state without creating worktrees or mutating a real repository.
- [ ] As a workflow developer, adding a state or action causes contract/gallery completeness tests to fail until its metadata, handler, and representative scenario are declared.
- [ ] As a frontend developer, I render server-owned state, actions, plans, and session affordances without interpreting lifecycle names, agent counts, session roles, or autonomous files.

## Architectural Contract

### Shared versioned envelope

Feature, research, and feature-set projectors must emit the same top-level interaction envelope while retaining entity-specific data:

```js
{
  contractVersion,
  entity: { type, id, displayKey, name },
  state: { lifecycle, phase, lane, label, severity },
  presentation: { headline, contextLine, timeline, agentSummary },
  decisions: { primaryActionId, actions: [] },
  tools: [],
  blockers: [],
  allowedDrops: [],
  agents: [],
  sessions: [],
  plan: null
}
```

Every action/tool descriptor must declare a stable ID, label, group, ordering, intent, disabled reason when disabled, input/confirmation requirements, execution handler or client interaction surface, scope, and entity/agent/session identifiers needed to dispatch it. Zero or one enabled primary decision is allowed.

### Entity definitions

- Feature remains sourced from `FEATURE_INTERACTION_DEFINITION`; extend its projector rather than adding another feature action table.
- Research gains a canonical `RESEARCH_INTERACTION_DEFINITION` and versioned projector. Its machine transitions, action candidates, UI descriptors, and state presentation metadata must no longer be separately maintained.
- Feature sets gain a canonical interaction definition/projector for their derived states and actions. `buildSetValidActions` may remain only as a generated compatibility projection.
- Shared projector/schema utilities may be introduced, but feature, research, and set workflow policy must remain explicit and independently testable.

### Plans and sessions

- A running/stopped/failed autonomous feature contract includes the canonical controller state and ordered stage plan with past, current, and future stages, participating agents, stage status, and current session references.
- A feature-set contract includes ordered members, dependencies, member status, aggregate progress, current member, future members, conductor status, spec-review/revision work, and relevant sessions.
- Session DTOs include explicit server-owned affordances. A live attachable session emits a Peek tool/action with its session identity and interaction handler. The browser must not relabel Open Terminal or infer Peek from `running`, role names, tmux naming, or agent status.
- Evaluation is emitted only for eligible Fleet feature/research runs. Solo scenarios must never acquire evaluation state/actions through fixture defaults.

### Living gallery

- Add a repository-owned gallery application and `npm run gallery` command, defaulting to `http://127.0.0.1:3700` with a configurable port.
- The gallery is a development/test surface, not part of the production dashboard navigation or published documentation site.
- It loads production dashboard JavaScript renderers, action rendering, icons, and styles instead of maintaining a second card renderer or copied CSS.
- Its scenarios are built from canonical interaction definitions and normalized runtime-fact builders. Scenario declarations may choose valid facts and event histories, but may not hand-author `validActions`, decisions, tools, labels, primary action IDs, or arbitrary contracts.
- It includes filters for entity and state, scenario search, action inventory, source facts, and a completeness report. Buttons are non-mutating; session Peek opens a deterministic mock console surface.
- The gallery server must not require a live Aigon project, tmux, Pro package, credentials, network access, or writes beneath `.aigon/`.

## Acceptance Criteria

### Complete interaction contract

- [ ] Feature, research, and feature-set rows expose versioned interaction contracts with the shared envelope on `/api/status` wherever the full dashboard payload is requested.
- [ ] Feature autonomous plan/controller state, research workflow state/actions, feature-set member/conductor plan, and session Peek affordances are present in those contracts and affect the dashboard status fingerprint.
- [ ] All cross-cutting quota, failover, escalation, review recovery, close recovery, spec drift/reconciliation, autonomous, infra, session, and agent-control actions are projected before the contract is frozen; collectors and frontend code do not append them afterward.
- [ ] The four currently unmapped review continuation actions have descriptors and registered execution surfaces, or are deliberately removed from the engine definition with replacement workflow tests.
- [ ] Contract validation rejects duplicate `{ actionId, scope/entity/agent/session identity }` entries and more than one enabled primary decision.
- [ ] Compatibility `validActions`, feature-set action output, and legacy presentation fields are generated from the canonical projectors for non-dashboard consumers.
- [ ] The production feature, research, and set dashboard renderers consume contracts without action eligibility, ranking, label rewriting, plan inference, or Peek inference in the browser.
- [ ] `done` contracts contain no mutation decisions or live-session mutation tools; observation/history may remain available.

### Required gallery coverage

- [ ] Every non-transient resting state in the feature and research definitions has at least one generated gallery scenario.
- [ ] Every feature-set derived state is represented: idle, spec review/revision pending or active, running, paused on failure, paused on quota, stopped, blocked dependency, and complete.
- [ ] Feature and research each show solo work in progress, Fleet work with two agents in progress, solo ready, Fleet ready, Fleet evaluation, review, revision, failed/lost session recovery, quota pause with internally consistent agent facts, closing, and done.
- [ ] Feature scenarios include optional code review versus direct Close, close recovery, escalation disposition, autonomous solo and Fleet plans, stopped/failed autonomous recovery, and all live-session Peek roles.
- [ ] Research scenarios use research terminology and include Fleet-only evaluation, findings review/revision, autonomous research where supported, quota/failure recovery, closing, and done.
- [ ] Set scenarios show ordered past/current/future members, dependencies, progress, spec review/revision, conductor status, and Peek for live conductor/member sessions.
- [ ] Every operator-visible action catalog entry appears in at least one valid scenario; omissions, unreachable descriptors, duplicate identities, missing handlers, and impossible state/mode combinations fail automated tests.

### Gallery runtime

- [ ] `npm run gallery` starts the gallery on port 3700, prints the URL, fails clearly if the port is occupied, and supports `PORT=<port>`.
- [ ] The gallery runs independently of `aigon server`, the docs site on port 3600, and any target repo state.
- [ ] Desktop and mobile Playwright checks verify the gallery is nonblank, cards fit without incoherent overlap, filters work, completeness is green, and mock Peek opens/closes.
- [ ] The gallery uses the production card rendering path and production CSS; tests fail if it imports a gallery-only card renderer or duplicates action eligibility logic.

### Regression and documentation

- [ ] Existing feature dashboard behavior from F675 remains intact while research and set rendering migrate to the same contract boundary.
- [ ] Generated state/action documentation or a deterministic JSON inventory can be checked for drift in CI.
- [ ] `AGENTS.md` documents the new contract modules, gallery command/port, and the required touchpoints when adding a state or action.
- [ ] No Pro/internal implementation, credentials, maintainer workflow, or target-repo stack assumption enters OSS.

## Technical Approach

1. Extract a small shared interaction-envelope/action validation layer from `lib/feature-ui-contract.js`, keeping policy in the entity definitions.
2. Extend normalized runtime facts with autonomous plans and session affordance inputs; extend the feature projector without changing its public behavior unnecessarily.
3. Consolidate research states/actions/metadata into `RESEARCH_INTERACTION_DEFINITION`, add `buildResearchUiContract`, and generate legacy dashboard fields from it.
4. Define the feature-set interaction model and projector around the existing derived set/conductor read model, replacing the independent action list with a compatibility projection.
5. Add completeness enumeration that walks every definition and verifies descriptors, handlers, reachability fixtures, unique identities, allowed mode/state combinations, and primary-action invariants.
6. Add the standalone gallery server and fixture API. Serve production dashboard assets and a thin gallery shell that supplies generated rows to the production card pipeline. Keep filters/coverage/source-facts UI gallery-specific, not card markup.
7. Migrate the useful scenarios from `dashboard-state-card-gallery` through canonical runtime facts, deleting its hand-authored contract/action adapters rather than merging them.
8. Wire feature, research, and feature-set production collectors/renderers to the completed contracts; update status fingerprints and compatibility projections.

## Validation

```bash
node tests/unit/entity-ui-contract.test.js
node tests/unit/dashboard-state-gallery.test.js
node tests/integration/workflow-read-model.test.js
npx playwright test --config tests/dashboard-e2e/playwright.config.js state-consistency.spec.js critical-actions.spec.js dashboard-state-gallery.spec.js
npm run lint
node scripts/check-module-graph.js
```

Before implementation-complete:

```bash
npm run test:deploy
```

## Dependencies

- F675 unified-feature-ui-state-contract (done)

## Out of Scope

- Shipping the proposed new dashboard card visual design or merging its current styling into production.
- Changing lifecycle transitions, making optional review mandatory, or adding new workflow policy solely to simplify presentation.
- Feedback-card migration; feedback remains on its existing smaller state-query contract until separately scoped.
- A hosted/public gallery, production dashboard navigation item, or inclusion in the end-user docs build.
- Executing real actions, launching real agents, or attaching to real tmux sessions from the gallery.

## Open Questions

- None. Port 3700 is reserved for the gallery by this feature; docs remains on 3600.

## Related

- Prior work: F675 unified-feature-ui-state-contract
- Prototype: branch `dashboard-state-card-gallery` in the Aigon repository; migrate scenarios, not its inference adapters.

## Pre-authorised
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 677" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-677" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-677)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#675</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">unified feature ui state …</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#677</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">complete dashboard ui con…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
