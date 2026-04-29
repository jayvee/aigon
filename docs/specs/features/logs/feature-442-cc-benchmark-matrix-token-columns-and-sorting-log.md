# Implementation Log: Feature 442 - benchmark-matrix-token-columns-and-sorting
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: composer (code review pass)

**Date**: 2026-04-29

### Fixes Applied

- `fix(review): focus-visible ring for benchmark matrix sort header buttons` — `.bench-sort-btn` had no keyboard focus indicator; added `:focus-visible` outline aligned with `sidebar-item` so Enter/Space sorting meets the spec’s no-a11y-regression bar once Pro wires header buttons.

### Residual Issues

- **Feature incomplete vs acceptance criteria**: The branch only adds shared OSS styles (sort button chrome, token column alignment, sorted-row stripe reset). Columns (`tokens in`, `tokens out`, `$`), formatters, tri-state sort, `localStorage` persistence, `aria-sort`, and empty-cell `—` semantics live in Pro’s `dashboard/benchmark-matrix.js` (and are not present in this worktree). Those must ship in **aigon-pro** with the same class names or the CSS is unused.

- **Cross-repo coordination**: Spec Technical Approach points matrix behaviour at Pro; confirm Pro MR uses `.bench-sort-btn`, `.bench-token-col`, `.bench-row-sorted`, etc., and adds Playwright or manual verification per spec.

### Notes

- OSS `lib/perf-bench.js` / JSON shape already expose `tokenUsage` (F438); no writer change required on OSS for this feature’s data path.
