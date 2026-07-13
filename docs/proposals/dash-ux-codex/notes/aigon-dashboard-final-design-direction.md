# Aigon dashboard final design direction

Status: design candidate for approval. No feature specifications have been created.

Prototype: [`../prototypes/aigon-dashboard-final-review-candidate.html`](../prototypes/aigon-dashboard-final-review-candidate.html)

## Decisions retained

- Kanban remains the primary dashboard structure.
- All lifecycle lanes remain visible and comparable.
- Active lanes receive moderately more width; they do not take over the page.
- Features, research, and sets share one card anatomy.
- Cards are compact summaries by default.
- One card may expand vertically inside its lane to show a flat stage ledger.
- Healthy stage information is replaced by an exception summary when something goes wrong.
- Only one primary action is visible.
- Controller, session, transcript, and diagnostic detail is opened on demand.

## Compact card contract

The card displays:

1. Entity or set identity and aggregate progress.
2. Current feature or research topic.
3. Current stage, agent, model, and effort.
4. Next stage and assigned agent/model.
5. One primary action, one history toggle, and overflow.

It does not display separate controller, agent, review, autonomous-plan, session, and action panels.

## Expanded history contract

Expansion adds one flat chronological ledger. Every row contains:

- Stage name.
- Agent and model when applicable.
- Duration when known.
- Status: complete, running, changes, queued, waiting, or failed.

Only the current stage may expose a live observation action. Lower-level workflow events remain in the detail drawer or logs.

## Exception contract

An exception replaces the healthy Now/Next presentation with:

1. What happened.
2. One short explanation.
3. The consequence for the next stage or set.
4. One recovery or response action.

Severity:

- Amber: operator decision or normal revision required.
- Red: execution or session failed unexpectedly.
- Blue: automation stopped at a safe resumable boundary.

## Responsive behavior

- Desktop: elastic five-column grid.
- Narrow desktop/tablet: horizontal Kanban with the active lane initially scrolled into view.
- Mobile: lifecycle tabs selecting one full-width lane; card anatomy is unchanged.

## Proposed feature set after approval

1. Dashboard information architecture and component reference.
2. Elastic Kanban lanes and responsive navigation.
3. Compact feature/research/set card anatomy.
4. Inline stage-history expansion.
5. Unified exception and action hierarchy.
6. Observation drawer and session-source chooser.
7. Dense-state visual regression and accessibility coverage.

Suggested dependencies: `1 -> 2 and 3 -> 4, 5, and 6 -> 7`.
