# Evaluation: Feature 57 - control-surface-dashboard-operator-console

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-57-control-surface-dashboard-operator-console.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-57-cc-control-surface-dashboard-operator-console`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-57-cx-control-surface-dashboard-operator-console`

## Evaluation Criteria

| Criteria | cc | cx |
|----------|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 9/10 | 8/10 |
| Performance | 8/10 | 8/10 |
| Maintainability | 8/10 | 7/10 |

## Summary

Both implementations deliver a working two-view dashboard with Monitor + Pipeline/Kanban views, drag-and-drop, agent picker modals, and stage-aware action buttons. The core architecture is similar: tab toggle with localStorage persistence, shared data source, separate render functions per view.

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - **67 tests** (6 new) — strong coverage of inbox parsing, backlog scanning, done limiting, and in-progress preservation
  - **3 post-testing bug fixes** caught during user testing: stderr `❌` detection for false-success CLI responses, inbox files without IDs being dropped, and `parseFeatureSpecFileName` rejecting ID-less filenames — these are real issues that would have bitten in production
  - **Dedicated `/api/worktree-open` endpoint** that handles existing-session attach vs new-session creation — cleaner separation than routing through generic `/api/action`
  - **`drag-blocked` visual feedback** on invalid drop targets (red border) — clearer UX than silently ignoring
  - **Action logging** added to `/api/action` endpoint for `radar.log`
  - **Promise-based agent picker** allows clean async/await in drag-drop handlers
  - **Deduplication** of in-flight actions via `pendingActions` Set
  - Clean `parseFeatureSpecFileName` fallback for ID-less inbox files (modifies existing function)

- Weaknesses:
  - Dedicated `/api/worktree-open` adds backend surface area
  - Some innerHTML string building is mixed with imperative DOM creation
  - No responsive breakpoint for Pipeline view (5 columns at 200px min = needs 1000px+)

#### cx (Codex)
- Strengths:
  - **Responsive breakpoint** at 1200px collapses Kanban to single column for smaller screens
  - **Separate `parseDashboardFeatureFileName()`** function — doesn't modify existing `parseFeatureSpecFileName`, lower risk
  - **Menubar filtering** added to ignore non-active stages (prevents inbox/backlog cluttering menubar)
  - **Winner picker modal** for Fleet close action (radio buttons for single-agent selection)
  - **Stage-aware tmux avoidance** — skips `safeTmuxSessionExists()` for non-active stages (performance)
  - Routes worktree-open through existing `/api/action` — smaller backend surface
  - Default agent selection (cx pre-checked) in setup modal

- Weaknesses:
  - **62 tests** (1 new) — minimal test additions compared to cc's 6
  - **No stderr error detection** — will show false "success" toasts when CLI prints `❌` but exits 0
  - **No action logging** in `/api/action` endpoint
  - **Index-based button matching** in pipeline view — fragile if render order changes
  - **No `drag-blocked` feedback** — invalid drops are silently ignored (no visual cue)
  - **No focus management** in modals — accessibility gap
  - cx pre-checked as default agent is a minor bias

## Recommendation

**Winner:** cc (Claude)

**Rationale:** cc's implementation is more complete and production-ready. The 3 bug fixes discovered during testing (stderr `❌` detection, inbox file parsing, `parseFeatureSpecFileName` fallback) address real edge cases that cx missed. The additional tests (67 vs 62), action logging, `drag-blocked` visual feedback, deduplication of in-flight actions, and the dedicated `/api/worktree-open` endpoint all contribute to a more robust implementation. While cx has the responsive breakpoint and menubar filtering (both worth adopting), cc's attention to error handling and testing gives it the edge.

**Cross-pollination:** Before merging cc, consider adopting from cx:
- Responsive CSS breakpoint for Pipeline view (`@media (max-width: 1200px)` collapse to single column)
- Menubar filtering to exclude non-active stages from `renderRadarMenubarFromStatus()`
- Stage-aware tmux skipping for non-active stages (avoid unnecessary `safeTmuxSessionExists()` calls for inbox/backlog/done features)
- Winner picker modal for Fleet close action
