---
status: waiting
updated: 2026-03-16T00:01:36.994Z
startedAt: 2026-03-15T23:55:51.565Z
events:
  - { ts: "2026-03-15T23:55:51.565Z", status: implementing }
  - { ts: "2026-03-15T23:58:45.600Z", status: implementing }
  - { ts: "2026-03-16T00:01:36.994Z", status: waiting }
---

# Implementation Log: Feature 65 - kanban-card-ux-rethink
Agent: cc

## Plan

The spec's core insight was already correct: the state machine computes valid actions with priority/type metadata — the dashboard just needed to render it clearly. The approach was:

1. **State machine label updates** — change ambiguous labels to verb phrases that describe the outcome
2. **Priority-driven button hierarchy** — map `priority:'high'` → primary button style, everything else → new subdued secondary style
3. **Separate status from actions** — move eval badge out of the actions row into its own non-interactive section
4. **Remove legacy dead code** — the fallback rendering path is never reached (server always sends `validActions`), so delete it entirely

No changes to `lib/dashboard.js` or the server API were needed.

## Progress

### `lib/state-machine.js`
- `feature-close` (solo in-progress action): label `'Accept & Close'`, added `priority: 'high'` — surfaces as the primary button on submitted solo features
- `feature-review` (solo in-progress action): label `'Run Review'`
- `feature-eval` (fleet in-progress action): label `'Run Evaluation'` (kept existing `priority: 'high'`)
- `feature-eval` (fleet in-evaluation action): label `'Continue Evaluation'`, added `priority: 'high'` — Evaluate is primary in evaluation stage
- `feature-review` (solo in-evaluation action): label `'Run Review'`
- `feature-close` (in-evaluation transition): label `'Accept & Close'`

### `templates/dashboard/index.html`
- **New CSS**: `btn-secondary` (ghost/muted, 10px text, subtle border), `btn-danger` (red tint — was referenced but undefined), `kcard-status` section
- **`eval-badge`**: added `pointer-events:none; cursor:default; user-select:none` — visually distinct from buttons
- **`kcard-actions .btn-secondary`**: 10px/2px padding — smaller than primary buttons
- **`validActionBtnClass()`**: simplified to: `priority==='high'` → `btn-primary`, stop → `btn-danger`, everything else → `btn-secondary`
- **`buildValidActionsHtml()`**: removed eval badge from here; added sort (primary first, stop last); signature simplified to just `(validActions)`
- **`buildKanbanCard()`**: eval badge rendered in its own `kcard-status` div above actions; removed the entire legacy fallback `else` branch
- **Legacy button handlers**: deleted ~55 lines of dead handler code for `.kcard-btn-prioritise`, `.kcard-btn-setup`, `.kcard-btn-worktree`, `.kcard-btn-eval`, `.kcard-btn-review`, `.kcard-btn-close`

## Decisions

**Why `priority:'high'` as the sole signal for primary styling?**
The state machine already has a `priority` field designed exactly for this. Using it as the single source of truth keeps the dashboard's rendering logic trivially simple — no per-action-name special casing. If a new action needs to be primary, you add `priority:'high'` in the state machine, not in the template.

**Why add `priority:'high'` to solo `feature-close`?**
The spec says "solo features should surface the close path clearly". Without `priority:'high'`, neither solo close nor solo review would be primary — the user gets two equally-weighted buttons with no guidance. Adding `priority:'high'` to close makes the recommended path obvious while leaving "Run Review" as an optional secondary step.

**Why add `priority:'high'` to fleet in-evaluation `feature-eval`?**
The spec says "Fleet features: Evaluate = primary, Close = secondary". The in-progress fleet eval already had this priority; the in-evaluation continue-eval action was missing it.

**Why delete the legacy fallback rather than keeping it?**
The server has always sent `validActions` since the state machine was introduced (feature 63). The fallback was dead code — keeping it added cognitive load and meant there were two code paths to maintain. Removing it makes the invariant explicit: `validActions` is always present.

**What about the `eval-badge.margin-left:6px` removal?**
The badge had `margin-left:6px` which made sense when it was inline with buttons. Moved to `kcard-status`, the margin was removed to let flexbox gap handle spacing. The badge still has its full styling (background, border, color).
