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

- **Feature incomplete vs acceptance criteria** (resolved): The reviewer correctly noted the Pro logic was absent from this OSS worktree. Clarification: `~/src/aigon-pro/dashboard/benchmark-matrix.js` was updated in the same implementation session (commit `9e0ff7d` on aigon-pro main). It adds columns, formatters (`fmtTokens`, `fmtCost`), tri-state sort, `localStorage` persistence, `aria-sort`, and `—` empty-cell semantics — all using the CSS class names defined in this OSS commit. Browser-verified live against the running dashboard: sort arrows, token values (e.g. 20k / 1.4k / $0.60), and grouped-vs-flat view transitions all work as specified.

- **Cross-repo coordination** (resolved): Pro commit uses `.bench-sort-btn`, `.bench-token-col`, `.bench-token-val`, `.bench-row-sorted`, `.bench-agent-cell-flat`, matching this OSS stylesheet exactly.

### Notes

- OSS `lib/perf-bench.js` / JSON shape already expose `tokenUsage` (F438); no writer change required on OSS for this feature’s data path.
