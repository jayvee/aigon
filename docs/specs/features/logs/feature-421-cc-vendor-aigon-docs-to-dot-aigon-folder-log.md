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
