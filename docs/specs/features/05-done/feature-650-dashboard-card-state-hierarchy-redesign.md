---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T22:17:44.564Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard card state hierarchy redesign

## Summary

Dashboard feature and research cards currently surface many true-but-competing states at the same visual priority. A failed close can show "Close failed", "Autonomous failed", "Ready to close", "Approved", red close text, green review text, active agent panels, disabled terminal buttons, and recovery actions in one small card. The result is hard to parse: the operator cannot quickly answer "what is the current state, what caused it, and what should I do next?"

Redesign the dashboard card system so every feature and research card has one dominant current-state message, a quiet supporting history/progress section, compact agent/session detail, and a clear action area. The redesign must apply across feature cards and research cards in both the monitor and pipeline views, including cards shown inside feature-set groupings where feature/research card status is rendered. It must also add internal design guidance for future agents so this hierarchy does not regress.

This should be one feature, not a feature set: the design guidance and implementation need to ship together. A docs-only feature would not fix the current UI, and a UI-only feature would leave future agents without the rule that prevents the same clutter returning.

## User Stories

- [ ] As an operator scanning the dashboard, I can identify each active feature or research card's current state in under a few seconds.
- [ ] As an operator seeing a failure card, I can tell the active blocker from completed history without reading every green and red label.
- [ ] As an operator recovering a failed close or failed autonomous run, I see one primary recovery action and any secondary actions are visually subordinate.
- [ ] As an operator reviewing completed review/revision information, I can still find approval and agent/session details, but they do not compete with the active state.
- [ ] As an agent editing dashboard cards later, I can read internal design guidance that explains the card hierarchy and color rules before changing the renderer.

## Design Direction

### Card hierarchy

Every feature/research card should render in this order:

1. Identity: entity id, title, compact metadata badges.
2. Current state: one dominant headline/status block that answers "what is happening now?"
3. Cause/context: one short line or compact detail under the headline when the state is blocked, failed, waiting, or recovering.
4. Progress/history: quiet timeline or checklist of lifecycle milestones already completed.
5. Agent/session detail: compact by default; expandable or overflowed for terminal/session/debug controls.
6. Actions: one primary next action, then secondary actions, then overflow.

The card must not show multiple dominant status blocks for the same condition. For example, a close failure should not simultaneously render a red `Close failed` alert, a red `Autonomous failed` block, a red `! Close` timeline row, and another red `Close failed` button-like row at equal weight.

### State copy

Use concise, operator-facing labels. Examples:

- Current state: `Close failed`, `Recovering close`, `Review running`, `Awaiting input`, `Ready to evaluate`, `Research running`.
- Cause/context: `Feature close failed 8h ago`, `Reviewer approved changes; close failed afterward`, `Claude Code is waiting for input`.
- History/timeline: `Implemented by CU`, `Reviewed by CC`, `Revision complete`, `Close attempted`.

Avoid contradictory adjacent copy such as `Ready to close` immediately above `Close failed`. If both are true historically, phrase the sequence as history: `Review approved` -> `Close attempted` -> `Close failed`.

### Color rules

- Red is reserved for the single active blocker or failure on the card.
- Green is reserved for completed milestones and success confirmations, but should be visually quiet when the current state is a failure.
- Amber is for waiting/attention/intervention states that are not failures.
- Blue/purple/cyan remain supporting accents for running, evaluation, and research identity.
- Do not stack multiple filled red panels or multiple bright green success blocks on the same card unless they represent separate cards, not separate facts inside one card.

### Actions

- Render at most one primary action in the main action row.
- Recovery actions such as `Recover`, `Close with agent`, or `Resolve & close` should become the primary action only when recovery is the current operator task.
- Low-frequency debug/session controls such as `Open Terminal`, peek buttons, dev-server actions, and session attach controls should be compact, secondary, or in overflow unless the current state is explicitly "needs session intervention".
- Disabled controls should not occupy prominent vertical space. Hide them or demote them unless their disabled reason is the key current state.

### Agent detail

Agent sections should answer "who is active or needs attention?" rather than repeat the whole lifecycle. Completed agent facts should collapse into a compact summary when the card has a stronger current state.

Preferred examples:

```text
Agents: Cursor exited - Claude Code approved
```

or:

```text
Implement: CU complete
Review: CC approved
Close: failed
```

Avoid large nested panels for completed sessions unless the user expands details or uses overflow.

### Target failure-state shape

The close-failure card that motivated this feature should become conceptually closer to:

```text
F645 close integrity 2 preauth validation

Close failed - 8h ago
Feature close failed after review approval.

Progress
- Implemented by CU
- Reviewed by CC
- Revision complete
x Close failed

[Recover] [...]
```

Exact wording may vary, but the visual priority must match: one red current-state block, quiet completed history, and a clear recovery CTA.

## Acceptance Criteria

- [ ] All dashboard feature cards and research cards share the same state hierarchy rules in monitor and pipeline views: identity, current state, supporting context, progress/history, agent/session detail, actions.
- [ ] The current state is rendered as a single dominant state surface per card. Failure/recovery cards do not show duplicated red alerts or competing headline states.
- [ ] Completed review, approval, implementation, revision, and research milestones are still visible, but are rendered as quiet history/timeline items when they are not the active state.
- [ ] Feature close failure, autonomous failure, quota pause, awaiting input, code review complete, code revision complete, research ready-to-evaluate, research review complete, and normal in-progress states are each audited and rendered without contradictory adjacent copy.
- [ ] Feature and research cards use the same component/helper for state headline derivation where practical. If implementation keeps separate renderers, the shared design contract is documented in code and covered by equivalent tests.
- [ ] `validActions` remains the source of truth for action eligibility. The frontend may choose visual priority/order, but must not invent eligibility rules that conflict with server-owned workflow rules.
- [ ] The main action row renders no more than one primary action per card. Other actions go to secondary buttons or overflow.
- [ ] Agent/session controls are compact by default and do not create nested-card clutter. Terminal/debug controls are either inline compact controls, overflow items, or hidden until relevant.
- [ ] Research cards receive the same treatment as feature cards, including review/evaluation/ready states and research-specific labels.
- [ ] Feature-set card/group rendering does not reintroduce the same conflict for member feature/research status. If set cards keep a distinct visual system, any embedded member state summaries follow the same current-vs-history hierarchy.
- [ ] Internal agent guidance is added to the aigon repo's own docs (`docs/dashboard-card-design.md`), referenced from `AGENTS.md`, `CLAUDE.md`, and `docs/architecture.md` "Dashboard Frontend". It explains the dashboard card hierarchy, color rules, action priority, and "one dominant state" rule. Nothing is added to `templates/docs/` (target-repo boundary).
- [ ] `docs/card-design-wireframe.html` is updated (or explicitly superseded, with the `AGENTS.md` / `CLAUDE.md` pointers updated) so the canonical card reference and the shipped cards do not disagree.
- [ ] Visual QA screenshots are captured for at least these scenarios: normal running feature, failed close/recovery feature, completed review waiting for close, research ready to evaluate, research running/reviewing, and a feature-set group containing a failed member. Screenshots are saved under `./tmp/` (never the repo root) and referenced from the implementation log.
- [ ] Responsive QA covers at least 390px mobile width, 1280px desktop width, and a wide desktop layout. Cards must not clip text, overlap buttons, or grow from repeated nested panels.

## Validation

```bash
node -c aigon-cli.js
node --check templates/dashboard/js/monitor.js
node --check templates/dashboard/js/pipeline.js
node --check templates/dashboard/js/set-cards.js
npm run test:iterate    # mid-iteration gate (auto-runs Playwright @smoke when dashboard files change)
npm run test:deploy     # once, before feature-close - full core + browser + budget gate
```

Do not run `test:browser` / `test:ui` / `test:deploy` mid-iteration; `npm run test:iterate` is the iteration gate. Interactive UI verification from the worktree uses `aigon preview 650` and snapshots that preview URL - never the primary `aigon.localhost` and never `aigon server start` from the worktree.

## Pre-authorised

- May restart the Aigon dashboard server after editing `lib/*.js` or dashboard assets.
- May add focused dashboard fixture data or tests for card rendering states.

## Technical Approach

### 1. Audit card data and render paths

Start by mapping the fields currently available to feature and research cards:

- `lib/dashboard-collect/feature-poll.js`
- `lib/dashboard-collect/collect-research.js`
- `lib/workflow-read-model.js`
- `lib/state-render-meta.js`
- `templates/dashboard/js/monitor.js`
- `templates/dashboard/js/pipeline.js`
- `templates/dashboard/js/actions.js` and the per-action modules in `templates/dashboard/js/actions/` (including `actions/shared.js`, `actions/recovery.js`, `actions/close.js`)
- `templates/dashboard/js/set-cards.js`
- `templates/dashboard/js/autonomous-plan.js`
- `templates/dashboard/styles/monitor.css`
- `templates/dashboard/styles/kanban.css`
- `templates/dashboard/styles/components*.css`

Specifically audit `cardHeadline`, `stateRenderMeta`, `lastCloseFailure`, `autonomousSession`, `autonomousPlan`, `reviewStatus`, `reviewSessionSummary`, `reviewSessions`, `reviewCycles`, `evalSession`, `validActions`, `agents`, `currentSpecState`, and research equivalents.

Also read `docs/card-design-wireframe.html` before designing: it is the canonical card reference design (vocabulary, layout, all states) that `AGENTS.md` and `CLAUDE.md` direct agents to for pipeline card changes. This feature must either update that wireframe to reflect the new hierarchy or replace it and update the corresponding pointers - the wireframe and the shipped cards must not disagree after this feature.

Do not add new workflow engine states for this feature. This is a read/render/design-system cleanup unless the audit finds missing read-model data that prevents correct hierarchy.

### 2. Introduce a card presentation model

Prefer adding a small presentation helper that converts the raw dashboard row into a stable card display model, for example:

```js
{
  identity: { id, type, title, badges },
  currentState: { severity, label, detail, age, icon },
  timeline: [{ status, label, detail }],
  agentSummary: [{ label, state, agentId }],
  primaryAction,
  secondaryActions,
  overflowActions
}
```

Possible locations:

- Client-side helper if it only shapes existing `/api/status` data.
- Server-side helper if deriving `currentState` requires workflow-specific logic that should be shared by monitor, pipeline, and future clients.

Pick the least invasive location, but avoid duplicating state-priority rules independently in `monitor.js` and `pipeline.js`.

Architecture constraints (dash-arch F620-F628):

- If the server-side option adds new `/api/status` fields, add them to `computeStatusFingerprint` in `lib/dashboard-status-version.js`, or the ETag/SSE pipeline will not repaint cards when they change.
- If the client-side option is chosen, the helper must be a pure derivation over data that entered via `store.js replaceData` - no hand-mutation of store state.

State priority should be explicit and tested. Draft priority:

1. Active failure/blocker: close failed, autonomous failed, quota paused, unrecovered review failure.
2. Awaiting operator input.
3. Active recovery/revision/review/evaluation.
4. Running implementation/research.
5. Ready for next operator action.
6. Completed/resting states.

### 3. Clean up close-failure rendering

Use the motivating card as a regression target:

- `lastCloseFailure` should feed one current-state block.
- `autonomousSession` failure copy should become context/history if the underlying active problem is the close failure.
- The code review approval should remain visible as history, not as a competing green panel.
- `Ready to close` should not appear as a current success state after a close attempt failed. Rephrase as `Review approved` or move it into the timeline.
- `Recover` or equivalent should be the primary action when recovery is available.

### 4. Normalize action priority without changing eligibility

Continue rendering from `validActions`. The frontend can sort/group actions, but action availability must remain server-owned.

Update `templates/dashboard/js/actions.js` as needed so:

- only one high-priority action is shown as primary;
- recovery actions win primary priority when `currentState.severity === 'error'` or the action metadata marks recovery;
- destructive or low-frequency actions go to overflow;
- disabled actions do not dominate the card.

### 5. Reduce nested visual noise

Update CSS and markup so cards avoid:

- nested filled cards inside cards for ordinary agent rows;
- multiple red filled panels in one card;
- large all-caps monospace status blocks for supporting facts;
- repeated green success pills when the current state is not success;
- action buttons wrapping into confusing stacks.

Keep the operational density: this is not a marketing-card redesign. The dashboard should remain compact and scannable.

Any new stylesheet must be added to `templates/dashboard/styles/manifest.json` (sheets are served concatenated at `/styles.css`; unlisted files are silently ignored). Invoke `Skill(frontend-design)` before making the visual changes, per repo policy.

### 6. Internal design guidance for agents

Add the guidance to the aigon repo's own maintainer docs, **not** `templates/docs/` - templates install into target repos, target-repo agents never edit the dashboard renderer, and the target-repo boundary (`CLAUDE.md` rule 10, `AGENTS.md` target-repo boundary, `scripts/check-template-leaks.js`) forbids Aigon-internal content there. Recommended shape:

- Add `docs/dashboard-card-design.md` with the card hierarchy, state priority, color rules, action priority, and examples.
- Update `docs/card-design-wireframe.html` (the canonical card reference design) so the wireframe reflects the new hierarchy; the new doc and the wireframe must agree, with the wireframe as the visual reference and the markdown as the rules.
- Update the `AGENTS.md` dashboard frontend/card reference section, the `CLAUDE.md` rule-7 pointer, and `docs/architecture.md` "Dashboard Frontend" so future agents find the rules before editing the renderer.

The guidance must explicitly say:

- pick one dominant current state;
- separate current state from history;
- red only marks the active blocker/failure;
- green completed facts are quieter than the active state;
- show one primary action;
- apply the same pattern to feature and research cards.

### 7. Tests and QA

Add focused coverage at the lowest useful layer:

- Unit or fixture tests for state-priority derivation if a helper is introduced.
- Browser/UI tests or mocked dashboard status tests for the key scenarios listed in Acceptance Criteria.
- Screenshot/manual QA notes in the implementation log.

Existing test names may differ; use the repo's current dashboard test harness rather than inventing a new one.

## Dependencies

- none

## Out of Scope

- Changing workflow-core states or event semantics.
- Redesigning the entire dashboard navigation, sidebar, drawer, logs, settings, or analytics surfaces.
- Removing data from the detail drawer. The card can demote information while the drawer remains comprehensive.
- Reworking feature-set autonomous orchestration behavior. Only set-card display hierarchy is in scope.
- Changing CLI command behavior.

## Open Questions

- Should the presentation model live in the server read model so non-browser clients can share it, or in frontend helpers to keep `/api/status` unchanged?
- Should completed history be always visible as a compact timeline, or collapsed behind a "History" disclosure on smaller cards?
- What exact label should replace `Ready to close` after a failed close: `Review approved`, `Close attempted`, or another phrase?
- Should set cards get the same full hierarchy now, or only enforce it for embedded/member feature status in this feature?

## Related

- User-provided screenshot: failed close-integrity feature card with competing red/green status surfaces (two filled red `Close failed` surfaces plus an `Autonomous failed` panel, a green `Ready to close` line directly above a red failure chip, nested agent panels, and a disabled `Open Terminal` button all at similar weight).
- Canonical card reference design: `docs/card-design-wireframe.html` (`AGENTS.md` dashboard frontend section, `CLAUDE.md` rule 7) - must be updated in step with this feature.
- Prior feature: F297 autonomous mode stage status.
- Prior feature: F432 close-recovery state.
- Prior feature: F527 startup phase UI.
- Prior feature: F622/F623/F624 dashboard architecture work.
