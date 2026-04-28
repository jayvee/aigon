---
commit_count: 6
lines_added: 373
lines_removed: 106
lines_changed: 479
files_touched: 30
fix_commit_count: 1
fix_commit_ratio: 0.167
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 284
output_tokens: 93719
cache_creation_input_tokens: 657994
cache_read_input_tokens: 17403039
thinking_tokens: 0
total_tokens: 18155036
billable_tokens: 94003
cost_usd: 42.2363
sessions: 2
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 421 - vendor-aigon-docs-to-dot-aigon-folder
Agent: cc

Solo Drive worktree — install-agent + update-mode now iterate `templates/docs/` and vendor each file to `.aigon/docs/<name>.md`; per-agent docs go to `.aigon/docs/agents/<id>.md`. Aigon-the-repo dogfoods via `git mv` (history preserved). New 2.60.0 doctor migration moves pristine legacy `docs/development_workflow.md` / `docs/feature-sets.md` / `docs/agents/<id>.md` to `.aigon/docs/` (sha256 + AIGON_START marker check); diverged or user-owned files stay put with a warning. Updated AGENTS.md, docs/architecture.md, docs/README.md, scripts/setup-fixture.js, every `templates/generic/*` reference. New test `tests/integration/install-agent-vendored-docs-to-dot-aigon.test.js` covers install footprint + 4 migration paths.

## Code Review

**Reviewed by**: Cursor (composer)
**Date**: 2026-04-28

### Fixes Applied
- `b1a47a6d` — Restored mistaken scope removals: `docs/seeds.md`, `applySeedStateFixtures` + `lib/commands/setup/seed-reset.js` integration, feature 428 spec; removed stray inbox placeholder for live-log panel. Restored AGENTS.md seed guidance and reading-order line. Dropped unused `templatesAgentMd` in migration 2.60.0. Hardened `agent-registry-contract` test so `window.__AIGON_AGENTS__` JSON parses when strings contain `;`.

### Residual Issues
- None blocking. Core F421 install/migration path was already sound; main issue was unrelated file churn on the branch.

### Notes
- Iterate gate (`npm run test:iterate`) passes after the above.
