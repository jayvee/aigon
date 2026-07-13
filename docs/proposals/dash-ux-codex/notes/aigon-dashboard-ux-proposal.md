# Aigon dashboard UX redesign proposal

Status: design exploration only. No Aigon features have been created.

## Executive recommendation

Adopt an **Adaptive Focus Board** with **progressive-disclosure cards**.

- Preserve the five-stage pipeline as the overview.
- Let any lane become a wide focus lane; default focus to In Progress when it contains work.
- Make every card answer one question when collapsed: **what needs my attention now?**
- Move workflow history, agent detail, diagnostics, and secondary actions behind card expansion.
- Treat a feature set as an orchestration summary plus a compact member queue, not a container of full cards.

This combines Option A and Option B in the prototype. Option C, the Activity Workbench, is useful as a later power-user view but is too large a conceptual jump for the first iteration.

Interactive concepts: [`../prototypes/aigon-dashboard-ux-concepts.html`](../prototypes/aigon-dashboard-ux-concepts.html)

## What I reviewed

- Live Aigon dashboard at 1600px and 1800px widths across five registered repositories.
- Real Brewboard feature set, backlog, research, and closed-card states.
- Production card renderer and CSS, including headline, presentation, autonomous plan, agent, review, set, action, and overflow layers.
- Synthetic high-density states rendered through the real dashboard: autonomous implementation, fleet winner selection, close recovery, research fleet, and evaluation waiting for input.
- Existing dashboard E2E coverage, including autonomous stage-track and keyed-card rendering tests.
- Existing F650 card hierarchy wireframe and maintainer guidance.

## Findings

### 1. The card has become a page

The renderer can append identity, headline, timeline, controller status, autonomous plan, workflow state, nudges, agent panels, evaluation, review, GitHub, close failure, and actions. Each fragment is locally reasonable, but the aggregate has no stable information hierarchy.

### 2. The same state appears in multiple semantic layers

An autonomous card can show `Implementing` as the dominant headline, `Autonomy running` in a controller panel, `Implement` in the stage plan, and `Implementing` again in the agent row. These are different backend concepts but the user reads them as duplication.

### 3. Five equal 220px lanes are the wrong allocation

Inbox and Closed often need only identity and count, while In Progress and Evaluation contain live actors, elapsed time, recovery state, and actions. Equal widths spend scarce space uniformly despite radically different information needs.

### 4. Sets compound rather than summarize complexity

Set grouping adds a set header, controls, status, progress, and session state, then nests complete feature cards beneath it. The user must understand both orchestration state and member state at once.

### 5. Actions compete with status

Lifecycle actions, session controls, infrastructure controls, recovery actions, and destructive actions share the bottom of a narrow card. The next action is not consistently distinguishable from optional controls.

### 6. F650 helped precedence, not density

The single dominant headline and quiet timeline are correct foundations. They should remain. The next improvement is structural disclosure: decide what is visible at each density, not merely which fragment wins headline precedence.

## Design principles

1. **State before history.** Current state is always visible; completed steps are summarized until expanded.
2. **Attention before telemetry.** Show what needs a decision or intervention before implementation detail.
3. **One card, one primary action.** Secondary actions live in an overflow menu or expanded action area.
4. **Width follows activity.** Active work gets space; dormant queues become compact.
5. **Sets orchestrate members.** A set summarizes sequence and exposes only the current member at full fidelity.
6. **The same anatomy everywhere.** Feature and research cards share primitives; vocabulary and available actions differ.
7. **User-controlled density.** Expansion, lane focus, and density preferences persist per repository and entity type.

## Option A: Adaptive Focus Board

### Layout

- Five lanes remain visible.
- Default ratios when work is active: Inbox `0.65`, Backlog `0.9`, In Progress `2.1`, Evaluation `1.35`, Closed `0.55`.
- Each lane header has a focus control. Focusing a lane makes it roughly 45-55% of the board while other lanes become narrow overview rails.
- A `Reset layout` control returns to equal lanes.
- Focus choice persists separately for Features and Research.
- At small widths, the focused lane is first and full-width; other lanes become horizontal tabs.

### Why it works

- Keeps the familiar lifecycle model.
- Directly solves the width constraint.
- Gives Evaluation extra room when it contains a decision.
- Does not force all cards to become dense tables or open drawers.

### Risk

Lane resizing alone does not solve card repetition, so it must ship with progressive disclosure.

## Option B: Progressive-disclosure cards

### Collapsed card contract

Collapsed cards show only:

1. Identity: id, title, entity/set badges.
2. Dominant status: verb, owner, elapsed time, attention severity.
3. Progress summary: `1 of 4` plus a thin stage rail, not a vertical history list.
4. One primary action and an overflow button.
5. Expand control with an accessible label and expanded-state count, such as `Details (3)`.

### Expanded card contract

Expanded cards add four bounded sections:

- **Now:** current activity, blocker/recovery context, live session link.
- **Workflow:** stage history and autonomous plan.
- **People:** agents, reviewer, evaluator, model/effort, liveness.
- **Actions:** secondary lifecycle, session, infrastructure, and destructive actions grouped by intent.

Only one card should be expanded per lane by default. Users can pin multiple cards open.

### Why it works

- Scanning becomes predictable.
- Advanced information remains available in context.
- The design scales when new capabilities are added because every new datum must declare its disclosure tier and section.

### Risk

Expansion state and keyboard behavior need careful persistence and accessibility rules.

## Option C: Activity Workbench

Replace the In Progress and Evaluation lanes with a master-detail view: compact work rows on the left and a persistent activity inspector on the right.

### Why it works

- Best use of space for long-running autonomous and fleet work.
- Excellent for session activity, logs, workflow stages, and recovery controls.
- Makes the selected item unambiguous.

### Why it is not the first recommendation

- It changes the dashboard mental model substantially.
- It overlaps the existing detail drawer and terminal surfaces.
- It is better introduced later as an optional `Work` view after card anatomy is stabilized.

## Feature-set treatment

The set card should become an orchestration object rather than a visual wrapper.

Collapsed set:

- Goal/name and aggregate state.
- `2 of 5 merged` progress rail.
- Current member and next member.
- One orchestration action, such as `Pause set` or `Resolve blocker`.

Expanded set:

- Current member renders as one expanded feature card.
- Completed and upcoming members render as compact rows on a sequence rail.
- Set controller/session detail appears once at set level.
- Member cards do not repeat the set controller state.

## Research treatment

Research uses the same card shell and density rules.

- Dominant verbs: `Researching`, `Synthesizing`, `Needs input`, `Ready to close`.
- Findings and evaluation report are research-specific expanded sections.
- Fleet researchers collapse into a participant summary; detailed agent rows appear only when expanded or when one needs attention.

## Design pattern documentation

Create two durable maintainer documents during implementation:

1. `docs/design/dashboard-patterns.md`
   - Information hierarchy and disclosure tiers.
   - Layout, spacing, typography, color, motion, and responsive rules.
   - Status/severity vocabulary and accessibility requirements.
   - Action priority and grouping rules.
   - Rules for features, research, feedback, and sets.

2. `docs/design/dashboard-component-reference.md`
   - Visual examples and DOM/API contracts for lane headers, cards, status headlines, progress rails, set sequences, agent summaries, action groups, badges, and empty states.
   - Allowed variants, anti-patterns, and test selectors.

The existing `docs/dashboard-card-design.md` should be migrated into these documents rather than creating a third competing source of truth.

## Provisional feature set

No specs have been created. After design approval, I propose the set `dashboard-clarity`:

1. **Dashboard information architecture and design-system foundation**
   Define disclosure tiers, shared primitives, tokens, accessibility behavior, and the two reference documents.

2. **Adaptive pipeline focus lanes**
   Add activity-weighted widths, manual lane focus/reset, persistence, and responsive lane tabs.

3. **Progressive-disclosure feature and research cards**
   Implement collapsed/expanded anatomy, progress rail, grouped details, keyboard support, and preference persistence.

4. **Feature-set orchestration card and member sequence**
   Replace nested full-card bundles with aggregate set state, current-member focus, and compact sequence rows.

5. **Action hierarchy and attention model**
   Enforce one primary action, group secondary controls, unify attention severity, and remove repeated state surfaces.

6. **Dashboard visual regression and interaction coverage**
   Add representative dense-state fixtures, screenshots at desktop/tablet/mobile widths, keyboard tests, and regression cases for autonomous feature/set and research evaluation states.

Suggested dependencies: `1 -> 2 and 3 -> 4 and 5 -> 6`.

## Approval decisions

Please decide:

1. Approve the recommended **Option A + B hybrid**, or select A, B, or C independently.
2. Should In Progress auto-focus whenever non-empty, or should focus always be manual?
3. Should card expansion be inline, or should expanded detail use a persistent right-side inspector?
