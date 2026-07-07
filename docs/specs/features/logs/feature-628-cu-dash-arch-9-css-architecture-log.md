---
commit_count: 3
lines_added: 2030
lines_removed: 1687
lines_changed: 3717
files_touched: 29
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 628 - dash-arch-9-css-architecture
Agent: cu

## Status
Complete. Monolithic `styles.css` split into 21 ordered sheets under `templates/dashboard/styles/`; `/styles.css` served via server-side concat (`lib/dashboard-styles.js`).

## New API Surface
- `lib/dashboard-styles.js`: `concatDashboardStyles(templateRoot)`, `readManifest`, `DEFAULT_MANIFEST`, `clearDashboardStylesCache`.
- `templates/dashboard/styles/manifest.json`: ordered sheet list for concat.

## Key Decisions
- **Delivery: option (b)** — server concat at `/styles.css` (same single `<link>` in `index.html`, no FOUC). Preview servers inherit the concat path via existing `templateRoot` wiring.
- **Mechanical split first** — 21 files cut on comment seams preserving cascade order; normalized CSS byte-match verified before dead-rule pass.
- **Formatter** — multi-rule lines expanded to one rule per line within each slice (`scripts/split-dashboard-styles.js` one-shot helper).
- **Cascade verification** — `stripForCompare(concat) === stripForCompare(format(monolith))` in split script + `tests/integration/dashboard-styles-split.test.js`.

## Gotchas / Known Issues
- Primary `aigon server restart` refused from worktree; preview (`aigon preview 628`) used for manual verification at `http://localhost:4137`.

## Explicitly Deferred
- Inline `style="..."` migration — **221** occurrences across `index.html` + `js/**` + `stubs/**` (count via `rg -c 'style="'`); recorded for follow-up.

## For the Next Feature in This Set
- Edit the relevant sheet under `templates/dashboard/styles/` (see `manifest.json` order); never re-grow a monolithic `styles.css`.
- After sheet edits, `npm run test:iterate` auto-runs browser smoke when dashboard paths change.

## Dead-rule audit (removed selectors + grep evidence)
| Selector(s) | Evidence |
|---|---|
| `.spec-review-wrap`, `.spec-review-badge` (+ `:hover`) | `rg` over `templates/dashboard/{index.html,js/**,stubs/**}` — zero matches (badge UI removed; pipeline uses status pills) |
| `.liveness-dot`, `.liveness-alive`, `.liveness-stale`, `.liveness-dead` | `buildLivenessIndicator` in `pipeline.js` emits `dot live`, not `liveness-dot` — zero class-string matches |
| `.run-next-group`, `.run-next-primary`, `.run-next-chevron`, `.run-next-dropdown`, `.dropdown-item`, `.item-label`, `.item-command`, `.item-reason` | zero matches in html/js; only legacy spec doc F60 — kept `.run-next-spinner` (actively used) |
| `.ai-agent-id`, `.ai-agent-name` | zero matches; ask-agent UI uses `.ask-agent-option` without these classes |
| `.all-items-btn-hidden` | zero matches in html/js |

## Test Coverage
- `npm run test:iterate` green (incl. Playwright @smoke 14/14).
- `tests/integration/dashboard-styles-split.test.js` — manifest concat regression.
- Preview screenshots: `tmp/feature-628-{monitor,pipeline,settings,stats,sessions,drawer}.png`.

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Reviewed the `/styles.css` concat route, preview `templateRoot` path, manifest order, packaging surface, and documented dead-rule removals. No follow-up fixes required from the implementing agent.
