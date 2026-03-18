---
status: submitted
updated: 2026-03-18T02:00:00.000Z
startedAt: 2026-03-18T01:17:07.932Z
completedAt: 2026-03-18T02:00:00.000Z
events:
  - { ts: "2026-03-18T01:17:07.932Z", status: implementing }
  - { ts: "2026-03-18T01:22:14.919Z", status: implementing }
  - { ts: "2026-03-18T02:00:00.000Z", status: submitted }
---

# Implementation Log: Feature 92 - split-dashboard-html-into-modules
Agent: cc

## Plan

Split the 4,057-line `templates/dashboard/index.html` monolith into:
1. `templates/dashboard/styles.css` — extracted CSS
2. `templates/dashboard/js/*.js` — 12 logical JS modules
3. Slim `index.html` (~324 lines) with `<link>` and `<script>` tags
4. Server route additions to serve new static files

## Decisions

**Template placeholders stay in index.html inline script**: `INITIAL_DATA` and `INSTANCE_NAME` are substituted server-side by `buildDashboardHtml()`. Since the JS module files are served as static files (not templates), these placeholders must remain in an inline `<script>` block in index.html. `state.js` references them as pre-defined globals.

**`<script>` tags over ES modules**: Following the spec's recommendation, kept simple `<script>` tags with global scope to avoid MIME type complications and stay zero-config.

**No console.js**: The spec doesn't list console.js — the console view code lives in `logs.js` (both are simple view-render functions with no sub-section of their own).

**Server route**: Added `/js/` and `/styles.css` routes to `dashboard-server.js` pointing at `templates/dashboard/`. Also updated `tests/dashboard/server.js` to serve these paths.

**Load order**: state → utils → api → terminal → sidebar → spec-drawer → monitor → pipeline → settings → statistics → logs → init. Alpine is deferred in `<head>` so all body scripts execute first, then Alpine runs and the `alpine:init` listener in state.js fires.

## Progress

- [x] Extracted 449-line CSS to `templates/dashboard/styles.css`
- [x] Created 12 JS modules in `templates/dashboard/js/`
- [x] Reduced `index.html` from 4,057 → 324 lines
- [x] Added server routes in `dashboard-server.js` and `tests/dashboard/server.js`
- [x] 159 unit tests pass
- [x] 28/30 Playwright tests pass

## Issues

Two pre-existing Playwright test failures exposed (not caused) by this refactoring:
1. `monitor.spec.js:49` — "shows agent status dots": expects `.feature-card .dot` but the monitor view renders agent status as icons (`kcard-agent-status` spans), not `.dot` elements
2. `pipeline.spec.js:60` — "in-progress column shows agent badge": expects `.agent-badge` in in-progress column, but active-agent cards use `buildAgentSectionHtml` (not `buildAgentBadgesHtml`). The `.agent-badge` class only appears for legacy cards without active agents.

Both were previously masked as timeouts (JS never loaded before this refactoring). The underlying code behavior is unchanged — the tests were written against a different UI structure.
