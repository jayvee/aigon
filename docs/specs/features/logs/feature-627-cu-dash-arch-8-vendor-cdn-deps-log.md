---
commit_count: 5
lines_added: 279
lines_removed: 7
lines_changed: 286
files_touched: 14
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 627 - dash-arch-8-vendor-cdn-deps
Agent: cu

## Status
Complete. Four CDN scripts vendored locally; zero `cdn.jsdelivr.net` in dashboard HTML.

## New API Surface
None.

## Key Decisions
- Pinned marked at **15.0.12** (what jsdelivr `marked/marked.min.js` resolves today — not npm latest 18.x).
- Alpine 3.15.12, Chart.js 4.5.1, chartjs-adapter-date-fns 3.0.0 — jsdelivr `@3`/`@4` tag resolution.
- New vendor payload ~345KB minified; `npm pack --dry-run` reports package 1.4 MB / unpacked 5.8 MB (templates already shipped in `files`).

## Gotchas / Known Issues
- `https://www.aigon.build/docs` docs-link href remains (user navigation, not a runtime script fetch).

## Explicitly Deferred
None.

## For the Next Feature in This Set
- dash-arch-9+ can assume all dashboard runtime JS is same-origin under `/js/vendor/`.

## Test Coverage
- `npm run test:iterate` + `npm run test:browser` green.
- Offline screenshot: `tmp/feature-627-offline-vendor.png` (jsdelivr blocked; Alpine/marked/Chart globals + store OK).

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- b90248e94 fix(review): update Alpine loading comment

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Reviewed the vendored asset wiring, static serving path, package inclusion via `package.json` `files`, ESLint vendor ignores, and dashboard external URL references. The only fix was a stale Alpine comment that still referred to CDN loading.
