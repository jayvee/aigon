---
commit_count: 6
lines_added: 421
lines_removed: 206
lines_changed: 627
files_touched: 14
fix_commit_count: 2
fix_commit_ratio: 0.333
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 6357438
output_tokens: 26773
cache_creation_input_tokens: 0
cache_read_input_tokens: 6106496
thinking_tokens: 6721
total_tokens: 6384211
billable_tokens: 6390932
cost_usd: 14.1503
sessions: 2
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 309 - unify-terminal-config-with-migration-framework
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cc
**Date**: 2026-04-22

### Fixes Applied
- `fix(review): always tmux in research-start Fleet mode` (a9207a6b) — `lib/commands/research.js` still gated Fleet tmux creation on `fleetConfig.terminal === 'tmux'`, but `terminal` was removed from `DEFAULT_GLOBAL_CONFIG`, so the branch was dead and Fleet research sessions would never get tmux sessions created. Mirrors the feature-start Fleet change (always tmux; GUI app choice only affects attach).
- `fix(review): rename dashboard settings schema terminal -> terminalApp` (73bc3072) — `DASHBOARD_SETTINGS_SCHEMA` in `lib/dashboard-server.js` still exposed `key: 'terminal'` with legacy options `['warp', 'terminal', 'tmux']`. The spec explicitly calls this out (“Dashboard terminal dropdown … shows only `terminalApp` values”). Updated to `terminalApp` / `['warp', 'iterm2', 'apple-terminal']`.

### Residual Issues
- `runPendingGlobalConfigMigrations` uses `baseline = max(schemaVersion, fromVersion)`, which in the normal upgrade path works (schemaVersion absent → baseline = previous installed version < migration version). On a fresh install on a post-migration CLI with no `.aigon/version` recorded, `fromVersion` defaults to `'0.0.0'` and the migration still runs as a no-op (legacy keys absent, no log line), so correctness is preserved. Not worth changing — just flagging for future migrations that assume a different baseline semantic.
- Runtime compat: `loadGlobalConfig()` normalises legacy keys before merging, but `saveGlobalConfig`’s sanity check still allows a payload with only `terminal` as the “expected key” — the error message now only mentions `terminalApp`. Left as-is: during the compat window the tolerance is a feature, and the error message pointing at the new canonical key is intentional.
- `loadGlobalConfig` silently drops unrecognised `terminalApp` values (anything outside `warp`/`iterm2`/`apple-terminal`) via `canonicalizeTerminalApp → null`, falling back to the platform default. This is probably fine — values like `"vscode"` were never legal — but worth a heads-up in release notes.

### Notes
- Global migration framework, compat reads, env-var deprecation, tests, and docs all align with the spec.
- `saveGlobalConfig` still accepts a legacy-shaped payload (doesn’t reject bare `terminal` keys) which preserves round-trips during the compat window.
- No UI affordance was changed beyond the settings schema label/options — the frontend will pick up the new key automatically via the generic settings renderer.
