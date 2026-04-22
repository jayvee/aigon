---
commit_count: 5
lines_added: 1429
lines_removed: 119
lines_changed: 1548
files_touched: 17
fix_commit_count: 2
fix_commit_ratio: 0.4
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 9780031
output_tokens: 35518
cache_creation_input_tokens: 0
cache_read_input_tokens: 9470592
thinking_tokens: 9689
total_tokens: 9815549
billable_tokens: 9825238
cost_usd: 21.7383
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 307 - dashboard-server-reliability-hardening
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cc (Claude Code, Opus 4.7)
**Date**: 2026-04-22

### Fixes Applied
- `fix(review): expand lint to lib/**/*.js and dedupe /api/health collector calls`
  - Lint script was hand-picking ~10 files; spec AC required `lib/` coverage. Switched to a glob — all 62 lib files now lint-clean (0 errors, 1 pre-existing unused-eslint-disable warning in `lib/pro-bridge.js`).
  - `/api/health` handler was invoking `collectDashboardStatusData()` twice per request (once inside `collectDashboardHealth`, once to refresh `latestStatus`). Inlined the health payload build so the collector runs once and the refreshed status populates the cache.

### Residual Issues
- **`no-undef` warning: `lib/pro-bridge.js:77`** has an orphan `/* eslint-disable no-console */` directive. Non-fatal, left alone to avoid touching an unrelated file.
- **`templates/dashboard/js/` lint coverage not added.** Spec AC listed it alongside `lib/`. The dashboard JS is browser-side with heavy cross-file globals (`INITIAL_DATA`, `INSTANCE_NAME`, Alpine helpers, `showToast`, etc.) — enabling `no-undef` requires a dedicated flat-config block with a broader globals map. Not safely patchable in this review pass; tracked as a follow-up.
- **`FEATURE_ENGINE_RULES` alias is dead.** `lib/workflow-rules-report.js` now exports the alias, but no caller anywhere references `FEATURE_ENGINE_RULES`. The spec's stderr report must have come from a consumer that has since been removed; keeping the alias is harmless but adds no coverage. Consider deleting, or locating the original caller.
- **Spec's six known errors — only #1 and #2 clearly addressed.** 
  - `rebaseNeeded` — prior fix, regression test exists (`rebase-needed.test.js`). ✅
  - `FEATURE_ENGINE_RULES` — alias added. ✅ (but see above)
  - `log is not defined` — no fix visible in the diff. ⚠️
  - `featureMachine` already-declared — only one declaration now grep-able, but no targeted commit in this branch; may have been fixed upstream. ⚠️
  - `duplicate-matches-snapshot-mismatch` — no fix visible; no changes to `feature-spec-resolver.js` or spec-move producers. ⚠️
  - `TypeError: path argument null` (284 hits) — no null guards added to any `path.join`/`path.resolve` call-site. ⚠️
- **Test budget is over ceiling (2663 / 2500).** Pre-existing on main (2699 LOC); this branch net-reduces test LOC. Not caused by the feature, but `check-test-budget.sh` will still block a push until the ceiling is raised or tests are trimmed.
- **`templates/generic/commands/feature-do.md:42`** still instructs agents: "After every meaningful change: `git add -A && git commit -m ...`". Contradicts `templates/agents/gg.json` and the spirit of AC #3. Out of scope for the "aigon-internal commit path" rule (this is prompt advice, not aigon's own git), but worth aligning.

### Notes
- Smoke probe correctly wired: `runDashboardServer` calls `refreshLatestStatus()` synchronously at line 1322 before the HTTP server binds, so a collector throw propagates out of the server boot and exits the process non-zero — matches AC #1.
- `waitForServerHealthy` now probes `/api/health` first, falling back to `/api/supervisor/status` and `/`. `aigon server status` reports `unhealthy` when `/api/health` returns non-200 or is unreachable.
- Per-feature error isolation in `collectFeatures` is in place — the full loop body is wrapped, not just the `getFeatureDashboardState` call.
- `git add -A` / `git add .` are gone from the three files asserted in `static-guards.test.js` (`feature-close.js`, `worktree.js`, `setup.js`), via new `parseGitStatusPaths` / `stageExplicitGitPaths` helpers.
