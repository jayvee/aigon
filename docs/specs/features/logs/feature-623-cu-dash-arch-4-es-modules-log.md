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
