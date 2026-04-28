---
commit_count: 4
lines_added: 159
lines_removed: 226
lines_changed: 385
files_touched: 14
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 179
output_tokens: 56480
cache_creation_input_tokens: 308625
cache_read_input_tokens: 15950873
thinking_tokens: 0
total_tokens: 16316157
billable_tokens: 56659
cost_usd: 33.9517
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 420 - stop-scaffolding-consumer-agents-md
Agent: cc

Solo Drive worktree — install-agent stripped of all AGENTS.md scaffolding; deleted `syncAgentsMdFile`/`getProjectInstructions`/`getRootFileContent`/`getScaffoldContent` from `lib/templates.js`, removed callers + `if (config.rootFile)` block in `lib/commands/setup.js`, dropped `templates/scaffold.md`, `templates/root-file.md`, `docs/aigon-project.md`. Registered idempotent `doctor --fix` migrations (2.59.0 strips legacy `<!-- AIGON_START -->…<!-- AIGON_END -->` block from AGENTS.md, 2.59.1 deletes `docs/aigon-project.md`) — both leverage existing `lib/migration.js` per-version manifest tracking so each runs at most once per repo. End-of-install now prints an optional snippet the user MAY paste into AGENTS.md, but aigon never edits it. Updated `AGENTS.md`, `docs/architecture.md`, `docs/README.md` to match. New tests in `tests/integration/install-agent-no-agents-md-scaffold.test.js` cover: install with/without prior AGENTS.md (byte-identical assert), both migrations (strip block + delete file + idempotent re-run), drift guard for removed exports.

## For the Next Feature in This Set
F421 (vendor docs to `.aigon/docs/`) and F422 (manifest-tracked install) build on the now-narrow contract: aigon writes only into `.aigon/`, `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.agents/`. The install-paths string in `lib/commands/setup.js` (search `installPaths` / `aigonPaths`) is the canonical list — keep it in lock-step when adding new aigon-owned roots. The end-of-install snippet (printed from `install-agent`) is the only user-visible nudge toward AGENTS.md; future features should not regress this back to a write. F423 (brewboard seed refresh) will exercise both 2.59.x migrations as its end-to-end test.
