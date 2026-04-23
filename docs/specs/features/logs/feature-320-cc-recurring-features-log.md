---
commit_count: 0
lines_added: 0
lines_removed: 0
lines_changed: 0
files_touched: 0
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 312
output_tokens: 133355
cache_creation_input_tokens: 350019
cache_read_input_tokens: 19351615
thinking_tokens: 0
total_tokens: 19835301
billable_tokens: 133667
cost_usd: 9.1194
sessions: 2
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 320 - recurring-features
Agent: cc

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: op
**Date**: 2026-04-23

### Fixes Applied
- Reverted out-of-scope deletion of feature-322 and research-37 specs
- Reverted out-of-scope spec-check/spec-review cleanup changes (6 files: feature.js, dashboard-status-collector.js, dashboard-status-helpers.js, utils.js, pipeline.js, styles.css) — these removed `addressing-review` status, `activeReviewers`/`activeCheckers`/`specCheckSessions`, `buildSpecCheckBadgeHtml`, and related CSS classes, none of which relate to recurring features
- Removed duplicate `[mcp_servers.playwright]` TOML section in templates/cx/config.toml (lines after `# --- Aigon Configuration End ---` duplicated the section and would cause parse errors or overwrites)
- Removed out-of-scope `docs/specs/features/01-inbox/feature-role-specific-agent-config.md` spec (unrelated to recurring features)
- Fixed frontmatter carry-over bug in `lib/recurring.js:createAndPrioritiseFromTemplate` — the instance spec was stripped of all template frontmatter (losing `complexity`, `recommended_models`) instead of carrying over non-template-specific fields; now preserves `complexity`, `recommended_models`, `recurring_slug`, etc. while excluding only `schedule` and `name_pattern`

### Residual Issues
- The MCP approval note added after `# --- Aigon Configuration End ---` in `templates/cx/config.toml` is useful documentation but arguably belongs inside the Aigon config block or in `docs/agents/cx.md` rather than after the end marker; left as-is since it's not harmful and is a style preference
- `lib/recurring.js:createAndPrioritiseFromTemplate` serializes non-string frontmatter values with `JSON.stringify()` which produces JSON-style syntax (e.g. `{\"model\":null}`) rather than YAML-style; this works because `parseFrontMatter`/`parseYamlScalar` handles both, but could be improved with a proper YAML serializer if complex nested objects are needed in future templates

### Notes
- The core recurring features implementation (`lib/recurring.js`, `lib/commands/recurring.js`, `aigon-cli.js` wiring, `lib/dashboard-server.js` integration, built-in templates, `.gitignore` entry, `AGENTS.md` update, `docs/development_workflow.md` section) is solid and matches the spec's acceptance criteria well
- Concurrent-trigger guard, due-check logic, template validation, and the dedupe approach (open-instance scan + state-file bookkeeping) are all correctly implemented
- The implementer bundled several unrelated changes (spec-check removal, feature-role-specific-agent-config spec, cx config TOML duplication) that should have been separate features or commits
