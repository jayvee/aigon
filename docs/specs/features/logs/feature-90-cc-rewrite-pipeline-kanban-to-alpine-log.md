---
status: implementing
updated: 2026-03-18T01:18:20.508Z
startedAt: 2026-03-18T01:13:16.682Z
events:
  - { ts: "2026-03-18T01:13:16.682Z", status: implementing }
  - { ts: "2026-03-18T01:18:20.508Z", status: implementing }
---

# Implementation Log: Feature 90 - rewrite-pipeline-kanban-to-alpine
Agent: cc

## Summary

Rewrote the Pipeline (kanban) tab from vanilla JS DOM manipulation to pure Alpine.js declarative templates. The change eliminates `buildKanbanCard()`, `renderKanbanColCards()`, `buildAgentSectionHtml()`, `buildValidActionsHtml()`, and `buildAgentBadgesHtml()` — about 270 lines of imperative DOM code — replacing them with an Alpine `x-for` card template and ~30 reactive helper methods on the `pipelineView()` component.

## Approach

**Template**: Replaced `<div class="col-body" x-effect="renderKanbanColCards($el, repo, stage)">` with a full Alpine template containing `x-for` over `getStageFeatures(repo, stage)`. Three card variants handled inline via `x-if`:
1. Agent sections (multi-agent / non-solo): nested `x-for` per agent with primary action button and overflow menu
2. Solo Drive branch: "Drive" label with status, non-session actions only
3. Simple layout (inbox/backlog/done/research/feedback): agent badges, eval status, filtered actions

**State**: All card state lives in `pipelineView()` data:
- `expandedCols: {}` — keyed by `repoPath::stage` for the 8-item inbox/backlog expand
- `_openOverflowKey` — single reactive key tracks which overflow menu is open
- `_lastDraggedId` — suppresses spurious click after drag (same pattern as original per-card `wasDragged`)

**Drag-and-drop**: Migrated to `cardDragStart`/`cardDragEnd` methods using `x-on:dragstart/dragend`. Global `dragState` variable unchanged; the existing column `x-on:dragover/dragleave/drop` handlers continue to work without modification.

**Shared helpers kept**: `buildAgentStatusHtml()`, `isSoloDrive()`, `agentDisplayName()`, `AGENT_DISPLAY_NAMES`, `AGENT_ACTION_LABELS`, `validActionBtnClass()`, `handleValidAction()`. The Monitor tab is untouched.

## Decisions

- **Overflow menu state in pipelineView vs x-data per card**: Chose a single `_openOverflowKey` in the component rather than per-card `x-data` to avoid Alpine scope inheritance concerns with nested `x-for` + `x-data`. Same UX: opening one menu closes others.
- **`x-if` vs `x-show` for card sections**: Used `x-if` for structural card variants (agent/solo/simple) since only one applies per card. Used `x-show` for elements that may toggle (empty state, expand buttons).
- **wasDragged per-card → `_lastDraggedId` shared**: The original code had a closure-scoped `wasDragged` boolean per card element. Alpine's `x-for` template doesn't have per-element closure state. Replaced with a shared `_lastDraggedId` keyed by `featureId::name`. Correct because only one card can be dragged at a time.
- **`simpleCardActions()` moved into pipelineView**: The `buildValidActionsHtml` filtering/dedup/sort logic is now the `simpleCardActions()` method, identical logic, zero behaviour change.

## Issues

- Two pre-existing Playwright test failures (`monitor.spec.js: shows agent status dots` and `pipeline.spec.js: in-progress column shows agent badge`) were present before and after this change. Both check for elements that aren't rendered by the current code, so they are stale tests unrelated to this feature.
- Net line reduction is only 19 lines (4057→4038) because the Alpine template HTML is verbose. All specified vanilla JS code is removed; the spec's "~200 lines" estimate referred to the JS functions, not accounting for the HTML template that replaces them.
