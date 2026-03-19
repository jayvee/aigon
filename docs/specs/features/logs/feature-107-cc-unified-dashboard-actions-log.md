# Implementation Log: Feature 107 - unified-dashboard-actions
Agent: cc

## Plan

Create a shared `actions.js` module that both Monitor and Pipeline views call for rendering action buttons, replacing the two independent rendering paths (Monitor's `buildNextActionHtml` using legacy `nextActions`, and Pipeline's `buildValidActionsHtml` using `validActions`). Both views now use `validActions` from the state machine as the single source of truth.

The approach has three parts:
1. Extract and unify action rendering into `templates/dashboard/js/actions.js`
2. Add a close modal with winner picker and adoption checkboxes for fleet features
3. Update both views to delegate to the shared module

## Progress

### Implemented

**New file: `templates/dashboard/js/actions.js`** (main deliverable)
- `buildFeatureActions(feature, repoPath, pipelineType)` — single action renderer implementing 3-tier hierarchy:
  - **Primary**: first high-priority action → `btn-primary`
  - **Secondary**: other high-priority actions → `btn-secondary`
  - **Overflow**: everything else → hidden in `...` dropdown
- `handleFeatureAction(va, feature, repoPath, btn, pipelineType)` — unified action dispatcher handling all action types (open, setup, autopilot, eval, close, stop, prioritise)
- `showCloseModal()` / `hideCloseModal()` / `submitCloseModal()` — fleet close modal with winner picker (radio buttons) and adoption checkboxes
- `AGENT_DISPLAY_NAMES` and `AGENT_ACTION_LABELS` moved here from pipeline.js for shared access
- Special eval-done logic: when `evalStatus === 'pick winner'` and `winnerAgent` exists, primary button becomes "Close & Merge [winner name]"

**Modified: `templates/dashboard/index.html`**
- Added `<script src="/js/actions.js">` in load order between `spec-drawer.js` and `monitor.js`
- Added `#close-modal` HTML with winner radio buttons, adoption checkboxes, and Close & Merge button

**Modified: `templates/dashboard/js/monitor.js`**
- Replaced `buildNextActionHtml()` (25 lines, used legacy `nextActions`) with `buildMonitorActionHtml()` (5 lines, delegates to shared `buildFeatureActions`)
- Updated `handleMonitorClick()` to handle `kcard-va-btn` clicks via shared `handleFeatureAction()` and overflow toggle menus
- Monitor now uses `validActions` from the state machine instead of the legacy `nextActions` array

**Modified: `templates/dashboard/js/pipeline.js`**
- Removed `AGENT_DISPLAY_NAMES`, `AGENT_ACTION_LABELS`, `validActionBtnClass`, `buildValidActionsHtml`, `handleValidAction` (all moved to actions.js)
- Updated `buildKanbanCard()` in all three branches (multi-agent, solo drive, legacy) to use shared `buildFeatureActions()`
- Updated all `handleValidAction` references to `handleFeatureAction`

### Testing
- All 200 unit tests pass (174 CLI + 26 manifest)
- Syntax checks pass on all modified files
- Playwright tests not runnable in this worktree (`@playwright/test` not installed) — should be tested from main repo

## Decisions

**Monitor switches from `nextActions` to `validActions`** — This is the core unification. The legacy `nextActions` array was an inference layer that could disagree with the state machine. By switching Monitor to `validActions`, both views are guaranteed to show identical buttons for the same feature state.

**`buildAgentSectionHtml` stays in pipeline.js** — Per-agent sections (showing each agent's status, start/view/stop buttons) are pipeline-specific. Only card-level actions (close, eval, prioritise) needed unification.

**Close modal is a new DOM element, not reusing `#agent-picker`** — The close modal has different content (winner radio + adoption checkboxes) vs the agent picker (agent selection checkboxes/radios). Reusing would have required complex conditional rendering.

**`buildFeatureActions` filters out per-agent actions** — Actions with `agentId` set are excluded from the shared renderer since they're handled by `buildAgentSectionHtml` in pipeline or aren't relevant in monitor. This keeps card-level and per-agent actions cleanly separated.

**AGENT_ACTION_LABELS function signature changed** — The old pipeline version took `(va, agent)`, the new shared version takes `(va, feature)` and looks up the agent from `feature.agents`. The `buildAgentSectionHtml` call wraps the single agent in `{ agents: [agent] }` to match the new interface.

**Drag-drop left as-is** — The `onDrop` handler in pipeline.js handles transitions for drag targets, which is a separate interaction pattern from button clicks. It already works correctly and shares no rendering logic with button actions.
