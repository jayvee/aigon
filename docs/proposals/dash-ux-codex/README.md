# Dashboard UX exploration: Codex session

**Status:** design exploration archived for continuation. No feature specs were created and no dashboard implementation code was changed.

**Session date:** 2026-07-12 to 2026-07-13

This folder contains only the Codex exploration. The separate `docs/proposals/dash-ux/` folder belongs to another agent and was not modified by this session.

## Resume here

1. Open [`prototypes/aigon-dashboard-final-review-candidate.html`](prototypes/aigon-dashboard-final-review-candidate.html) in a browser.
2. Use the **Features / Research** switch.
3. Use the prototype **Healthy / Needs input / Failure** controls.
4. Use **Show history** to inspect the inline stage ledger.
5. Read [`notes/aigon-dashboard-final-design-direction.md`](notes/aigon-dashboard-final-design-direction.md) for the consolidated design contract and provisional feature-set outline.
6. Do not create Aigon feature specs until the operator approves or revises this direction.

On macOS:

```bash
open docs/proposals/dash-ux-codex/prototypes/aigon-dashboard-final-review-candidate.html
```

## Current candidate

The final candidate retains:

- Kanban as the primary dashboard structure.
- All five lifecycle lanes visible at once.
- Moderately wider active lanes rather than a full-page work view.
- One compact card anatomy for features, research, and autonomous sets.
- Current and next stage assignments, including agent and model.
- Inline vertical expansion for a flat stage/status history.
- Exception content that replaces healthy content instead of stacking on top of it.
- One primary action and an on-demand observation drawer.

Reference screenshots:

- [`evidence/aigon-final-feature.png`](evidence/aigon-final-feature.png): compact healthy feature/set card.
- [`evidence/aigon-card-history-expanded.png`](evidence/aigon-card-history-expanded.png): expanded stage history inside the Kanban lane.
- [`evidence/aigon-final-failure.png`](evidence/aigon-final-failure.png): failure replacing the healthy presentation.

## Operator feedback and design evolution

### 1. Initial diagnosis

The live dashboard and synthetic dense states confirmed that one 220px card could simultaneously render a headline, autonomous controller state, autonomous plan, agent panels, review state, session actions, failures, and lifecycle actions. The same state was often described several times.

### 2. First adaptive-board concepts

The initial proposal combined wider active lanes with progressive disclosure. The operator correctly rejected the detailed mockups because they preserved too many existing accretions: nested panels, repeated green indicators, duplicated controller/session state, and excessive labels.

Artifacts:

- `prototypes/aigon-dashboard-ux-concepts.html`
- `prototypes/aigon-stage-agent-session-mockup.html`
- `prototypes/aigon-dashboard-integrated-stage-mockup.html`

These are historical explorations, not the recommended design.

### 3. Full-workspace alternative

A minimal full-width active-work canvas removed the clutter successfully, but the operator rejected it because a single card took over the page and displaced the Kanban mental model.

Artifact:

- `prototypes/aigon-minimal-autonomous-set-dashboard.html`

This direction is explicitly rejected.

### 4. Elastic Kanban

The accepted foundation restored all five lanes and gave In Progress only moderately more width. An autonomous set became one ordinary card with set progress, current feature, current assignment, next assignment, and a single observation action.

Artifact:

- `prototypes/aigon-elastic-kanban-autonomous-set.html`

### 5. Unhappy paths

Failure and attention states replace the healthy Now/Next presentation. They show what happened, one explanation, the consequence, and one recovery action.

Covered scenarios:

- Agent needs operator input.
- Implementation tmux session is lost.
- Autonomous controller stops before review launch.
- Review requests changes.
- Close/post-merge gate fails.

Artifact:

- `prototypes/aigon-elastic-kanban-unhappy-paths.html`

### 6. Expanded history

The operator asked for a rundown of all stages and statuses. The card now expands vertically inside its lane to show one flat ledger with stage, agent/model, duration, and status. It does not recreate the old controller, agent, review, and action panels.

Artifact:

- `prototypes/aigon-elastic-kanban-expanded-history.html`

### 7. Consolidated candidate

The final candidate combines the viable concepts and includes feature and research examples, healthy/attention/failure states, inline history, and the observation drawer.

Artifact:

- `prototypes/aigon-dashboard-final-review-candidate.html`

## Folder contents

- `prototypes/`: every HTML mockup produced during the session, including rejected directions.
- `notes/`: the original proposal and consolidated final design direction.
- `evidence/`: live-dashboard captures, dense-state captures, and prototype screenshots.
- `tools/`: the synthetic status payload and Playwright visual-audit harness.

## Validation performed during the session

- Inspected the running dashboard at `http://127.0.0.1:4100` across registered repositories.
- Inspected Brewboard feature, research, set, and closed states without resetting its dirty seed repository.
- Rendered synthetic autonomous, fleet, review, close-recovery, and research states through the production dashboard renderer.
- Ran the existing Playwright autonomous-stage-track and keyed-card-render coverage successfully.
- Verified the final prototypes with Playwright at a 1500px desktop viewport.

## Proposed feature set after approval

The current provisional sequence is documented in `notes/aigon-dashboard-final-design-direction.md`:

1. Dashboard information architecture and component reference.
2. Elastic Kanban lanes and responsive navigation.
3. Compact feature/research/set card anatomy.
4. Inline stage-history expansion.
5. Unified exception and action hierarchy.
6. Observation drawer and session-source chooser.
7. Dense-state visual regression and accessibility coverage.

Suggested dependencies: `1 -> 2 and 3 -> 4, 5, and 6 -> 7`.
