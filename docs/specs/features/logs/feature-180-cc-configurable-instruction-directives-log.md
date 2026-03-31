---
commit_count: 3
lines_added: 237
lines_removed: 36
lines_changed: 273
files_touched: 6
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 384
output_tokens: 23955
cache_creation_input_tokens: 470101
cache_read_input_tokens: 15889241
thinking_tokens: 0
total_tokens: 16383681
billable_tokens: 24339
cost_usd: 34.4506
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: 89.15
---
# Implementation Log: Feature 180 - configurable-instruction-directives
Agent: cc

## Plan

Implement Phase 1 of configurable instruction directives — the `instructions.testing` field.

## Progress

- Added `resolveTestingPlaceholders()` to lib/config.js — maps `"full"`, `"minimal"`, `"skip"` to three template placeholders
- Added `computeInstructionsConfigHash()` — SHA-256 of instruction-relevant config (instructions, profile, verification)
- Updated `feature-do.md` template: replaced hardcoded Steps 3.8, 4.2 (Playwright), and 4.8 with `{{TESTING_WRITE_SECTION}}`, `{{TESTING_PLAYWRIGHT_SECTION}}`, `{{TESTING_RUN_SECTION}}`
- Updated `feature-now.md` template: same placeholder substitution for Steps 4.8 and 5
- Extended `getProfilePlaceholders()` to read `instructions.testing` from project config and merge testing placeholders
- Added config-change detection: `install-agent` and `update` write `.aigon/config-hash`; `check-version` compares stored vs current hash and triggers reinstall on mismatch
- Skipped config-hash writes in worktrees (consistent with `setInstalledVersion` pattern)
- Added 13 unit tests for `resolveTestingPlaceholders` and `computeInstructionsConfigHash`

## Decisions

- **Reused existing `PLAYWRIGHT_VERIFICATION` placeholder as `TESTING_PLAYWRIGHT_SECTION`**: The template previously used `{{PLAYWRIGHT_VERIFICATION}}` for Playwright steps. Rather than keeping both, `TESTING_PLAYWRIGHT_SECTION` subsumes it — when `testing` is `"full"` and Playwright is enabled, it resolves to the same content. The `PLAYWRIGHT_VERIFICATION` key is still computed in `getProfilePlaceholders()` for backward compat with any other templates.
- **Worktree skip for config-hash**: Following the same pattern as `setInstalledVersion()` — worktrees don't write state files to avoid merge conflicts.
- **Hash inputs limited to instruction-relevant fields**: `instructions`, `profile`, `verification` — keeps hash stable when unrelated config changes (agents, recovery, etc.).
