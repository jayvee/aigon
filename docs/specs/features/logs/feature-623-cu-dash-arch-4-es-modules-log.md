---
commit_count: 5
lines_added: 946
lines_removed: 401
lines_changed: 1347
files_touched: 46
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 623 - dash-arch-4-es-modules
Agent: cu

## Status
Wave 1 ESM entry landed: `main.js` + `injected.js` + `alpine-bindings.js`, bootstrap `__AIGON_BOOTSTRAP__`, Pro stubs as ESM exports, `globalThis` bridges for Alpine markup + cross-module calls. Fixed Alpine `state` proxy sync on `alpine:init`. Wave 2/3 (import graph cleanup, shrink eslint allowlist, remove `typeof` guards) deferred to follow-up commits.

## New API Surface
- `window.__AIGON_BOOTSTRAP__` replaces `__AIGON_AGENTS__` / inline `INITIAL_DATA` constants
- `/js/main.js?v=<version>` single module entry

## Key Decisions
- Transitional `Object.assign(globalThis, …)` per module until wave 2 replaces bare cross-file calls with imports
- Alpine CDN moved after `main.js` so `monitorView` / `pipelineView` / `STAGE_LABELS` exist before `x-data` evaluates
- `export let state` + `globalThis.state = state` on `alpine:init` keeps init.js and Alpine store in sync

## Gotchas / Known Issues
- `index.html` Alpine `x-text`/`x-html` still call bare globals (`STAGE_LABELS`, `buildAgentStatusSpan`, …) — intentional documented boundary until dash-arch-6/7
- `scripts/dashboard-esm-{migrate,fix-exports}.js` are one-shot helpers; safe to delete after wave 3

## Explicitly Deferred
- Wave 2: file-by-file `import` replacing `globalThis` shims
- Wave 3: break `state↔api↔init` cycles, delete eslint `dashboardAppGlobals` allowlist, remove `typeof fn === 'function'` guards

## For the Next Feature in This Set
- dash-arch-5 can import `state` from `./state.js` once wave 2 lands; until then read `globalThis.state` after `alpine:init`

## Test Coverage
- `npm run test:iterate` green (lint + scoped integration + browser @smoke)
- Lease-badge smoke: strip `If-None-Match` on Playwright `route.fetch` (304 empty body vs F620 ETag)

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- aa5682a41 fix(review): remove inline nudge hover handlers

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:architectural — The implementation log explicitly defers the spec's full import-graph cleanup, cycle break (`state`/`api`/`init`), `typeof fn === 'function'` guard removal, and eslint allowlist reduction. Completing those acceptance criteria would require a broad follow-up refactor across the dashboard module graph rather than a targeted review patch.

### Notes
- No out-of-scope deletions were present in the branch diff.
- The applied fix removes the remaining inline hover handlers found in the nudge quick-item HTML while preserving the same hover behavior through attached event listeners.
