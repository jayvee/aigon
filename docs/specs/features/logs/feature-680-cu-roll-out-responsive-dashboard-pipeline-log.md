# Implementation Log: Feature 680 - roll-out-responsive-dashboard-pipeline
Agent: cu

## Status
Responsive Pipeline layout ships behind `dashboard.contractCards` (same preview gate as F679): weighted lifecycle grid (`pipeline-responsive.css`), full-width `.wrap--operational` on Pipeline/Monitor views, stage-keyed contract density via `contractCardDensity()`, and `kanban--responsive` toggled from `/api/status` `contractCardsPreview`. Legacy kanban unchanged when preview is off.

## New API Surface
None — browser-only layout classes (`wrap--operational`, `kanban--responsive`, `data-pipeline-column`).

## Key Decisions
Layout and density stay view concerns; no renderer forks. Wide tracks mirror F677 gallery weights (compact queue lanes vs expanded active/review). Medium reflow uses 3→2→1 column breakpoints without nested horizontal scrollers.

## Gotchas / Known Issues
`npm run test:gallery` e2e reuses port 3700 — a long-lived gallery server from another checkout can make the suite fail; unit gallery tests and production `@smoke` responsive tests pass in this worktree.

## Explicitly Deferred
Monitor responsive cutover (F681). Default-on and legacy kanban removal (F682).

## For the Next Feature in This Set
F681: apply the same `wrap--operational` full-width pattern to Monitor; reuse gallery Monitor composition as reference. F682: enable responsive grid unconditionally when deleting the preview switch.

## Test Coverage
`tests/dashboard-e2e/contract-cards-preview.spec.js` — two new `@smoke` cases (wide density + 390px overflow); `npm run test:iterate` green (19 smoke). Gallery unit 22/22. Intentional divergence from gallery Pipeline: production uses existing `.kanban`/`.kanban-col` DOM (not `.pipeline-board`) so drag/keyed reconcile wiring is unchanged.
