---
status: submitted
updated: 2026-03-16T13:40:00.921Z
startedAt: 2026-03-16T12:39:17.586Z
events:
  - { ts: "2026-03-16T12:39:17.586Z", status: implementing }
  - { ts: "2026-03-16T12:51:24.128Z", status: implementing }
  - { ts: "2026-03-16T13:19:15.319Z", status: waiting }
  - { ts: "2026-03-16T13:40:00.921Z", status: submitted }
---

# Implementation Log: Feature 71 - dashboard-modernise
Agent: cc

## Plan

Convert Monitor and Pipeline/Kanban views from vanilla JS render functions to Alpine.js reactive components, replacing the global `state` object with an Alpine `$store`, and add a Playwright test suite requiring no running aigon instance.

## Progress

All 5 acceptance criteria implemented and tested:

1. **Alpine.js added via CDN** — `defer` script tag in `<head>`; `[x-cloak]` CSS rule added
2. **Monitor view converted** — `monitorView()` Alpine component with `x-data`, `x-for`, `x-show`, `x-on:click`; handles filter pills, type toggle, repo/feature/research/feedback rendering, event delegation for `x-html`-injected buttons
3. **Pipeline/Kanban view converted** — `pipelineView()` Alpine component; kanban columns use `x-effect` to call `renderKanbanColCards()` (vanilla JS for complex drag-drop logic), preserving all existing event wiring
4. **Global state → Alpine $store** — `_rawState` / `state` swap pattern: plain object first, then reassigned to Alpine proxy after `alpine:init`
5. **Playwright test suite** — 30 tests across monitor, pipeline, actions, analytics specs; isolated server on port 4109; all tests pass

## Decisions

- **`x-effect` for kanban cards**: Rather than fully converting `buildKanbanCard()` to Alpine templates (which would require rewriting complex drag-drop logic), used `x-effect` on the column body to reactively call the existing vanilla JS function. This preserves correct behavior with zero risk.

- **`_rawState` / `state` swap pattern**: Alpine store proxy must be assigned after `alpine:init` fires. To keep all existing code working (which writes to `state`), kept `let state = _rawState` before init and reassigned `state = Alpine.store('dashboard')` inside the `alpine:init` handler. All subsequent writes go through the proxy automatically.

- **Event delegation for `x-html` buttons**: The "run next" dropdown buttons in the monitor view are injected via `x-html` (too complex for Alpine templates). Added `handleMonitorClick` event delegation at the component root with `.passive` modifier to wire up these buttons without Alpine template rewrites.

- **Test server port 4109**: Changed from 4100 to avoid conflict with running aigon radar on the default port.

- **Playwright route ordering**: Playwright matches routes in last-registered-first order. Fixed all test specs to register the catch-all `**/api/**` FIRST and specific routes (e.g. `**/api/status`) LAST, so specific mocks take precedence.

- **analytics.features mock shape**: The mock data initially had `features: { completed: [], totalCompleted: 48 }` (object), but `renderStatistics()` calls `.filter()` on it. Fixed mock to use `features: []` (array).

- **Kanban card display names**: `buildKanbanCard()` renders names with hyphens replaced by spaces (`feature-one` → `feature one`). Updated pipeline tests to expect space-separated names.

- **Feature card sort order**: `getFeatures()` sorts by `featureRank` (waiting < implementing < error < other). Tests that check "first card" updated to find cards by content rather than position.

## Test Results

30/30 Playwright tests pass. 2 pre-existing CLI unit test failures (unrelated to this feature, present on the unmodified branch).
