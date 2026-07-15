---
commit_count: 4
lines_added: 180
lines_removed: 2
lines_changed: 182
files_touched: 7
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
model: "cursor"
source: "no-telemetry-cursor"
---
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

## Code Review

**Reviewed by**: op
**Date**: 2026-07-15

### Fixes Applied
- `2b145e1e3` fix(review): toggle kanban--responsive per-board, not globally — `syncKanbanResponsiveClass` applied `kanban--responsive` to ALL pipeline boards when any repo had `contractCardsPreview` on. A repo with preview off got its legacy kanban grid replaced by the weighted responsive grid, contradicting the spec ("Legacy kanban unchanged when preview is off"). Each board now resolves its own repo from the first column's `data-repo-path` and toggles based on that repo's preview flag.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- `contractCardDensity` correctly maps pipeline stages to compact/expanded density. The `paused` stage returns compact, matching the original F679 behavior. Done features don't reach the contract renderer (no `uiContract`), so removing `isDone` from the density check is safe.
- The `--kanban-cols:4` CSS selector is dead code — no pipeline type produces 4 columns (features/research: 5 or 6; feedback: 5). Not harmful; left as defensive fallback.
- `data-pipeline-column` duplicates `data-stage` on `.kanban-col`. Used only by test selectors to avoid collisions with existing `data-stage` usage in reconciliation. Acceptable.
- Feedback pipeline column widths are positional (inbox=compact, triaged=queue, actionable=active, done=review, wont-fix=compact). The `done` column gets `review` width (268px) which is wider than needed, but this is a layout optimization, not a correctness issue, and feedback is a secondary pipeline type.
