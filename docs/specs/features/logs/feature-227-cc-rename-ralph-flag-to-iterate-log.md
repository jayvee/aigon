# Implementation Log: Feature 227 - rename-ralph-flag-to-iterate
Agent: cc

## Plan

Hard-rename `feature-do --autonomous`/`--ralph` to `--iterate`. Keep the
loop runner (`runRalphCommand`) untouched; do the flag translation in
`feature-do` so legacy internals don't move. Sweep user-facing strings in
`lib/`, `templates/`, `docs/`, root `*.md`, and the docs site for the old
flag and rewrite to `--iterate` / "iterate loop". Skip historical specs in
`05-done/` and `logs/` per AC3.

## Progress

- `lib/commands/feature.js` — `feature-do` now hard-errors when
  `--autonomous`/`--ralph` is passed (one-line migration hint, exit 1).
  When `--iterate` is passed, the args array is rewritten in place
  (`--iterate` → `--autonomous`) before being handed to `runRalphCommand`,
  so the loop runner stays unchanged.
- `lib/templates.js` — `feature-do` argHints now advertises `[--iterate]`
  instead of `[--autonomous]`.
- `lib/validation.js` — usage strings (printed when an ID is missing) now
  show `--iterate` examples. Config readers now consult
  `projectConfig?.iterate?.*` first, falling back to `autonomous?.*` and
  then `ralph?.*` so existing user configs keep working with no warnings.
- `lib/config.js` — `resolveConfigKeyAlias` now maps both `iterate` (new
  canonical) and `autonomous` (legacy) onto the underlying `ralph` storage
  key. The bare-shell agent-context warning now suggests `--iterate`.
- `lib/utils.js` — log scanner that powers the autonomous-mode adoption
  metric now matches `--iterate` and `--autonomous` so historical and
  current logs both count.
- `lib/commands/infra.js` — single help string updated to reference
  `--iterate` mode.
- `templates/help.txt`, `templates/sections/autonomous.md`,
  `templates/generic/commands/help.md`, `templates/generic/docs/agent.md`,
  `templates/docs/development_workflow.md` — all user-facing flag mentions
  rewritten.
- `docs/autonomous-mode.md` — full sweep: copy now talks about "iterate
  mode" and the Autopilot loop, examples use `--iterate`, the config snippet
  uses `iterate.*`, and a brief History section documents the rename.
- `docs/architecture.md`, `docs/development_workflow.md`,
  `docs/aigon-project.md`, `docs/agents/{claude,gemini,codex,cursor,mistral-vibe}.md`,
  `CLAUDE.md`, `AGENTS.md` — all reference `--iterate` now.
- `README.md` — removed the `feature-do --autonomous` row from the Pro
  table (per AC6 / 2026-04-07 product decision; the iterate loop is free).
- `site/content/reference/commands/feature/feature-do.mdx` — synopsis,
  flags list, and examples updated.
- `docs/specs/features/06-paused/{feature-feature-ship-command,feature-refactor-feature-implement-help-ux}.md`
  — paused specs that referenced the legacy flag now reference `--iterate`
  so they're consistent if/when picked up.
- `tests/integration/iterate-flag-rename.test.js` — new regression test:
  asserts `--autonomous` and `--ralph` exit 1 with the migration message,
  and that `templates.js` argHints advertises `[--iterate]`. Wired into
  `npm test`.

## Decisions

- **Translate at the call site, not in the loop.** The spec was explicit:
  zero changes to `runRalphCommand` internals. Rather than teach the loop
  to recognise `--iterate`, I rewrite the args array in `feature-do` so
  `runRalphCommand` still sees `--autonomous`. Keeps the diff small and
  the loop's behaviour identical.
- **Did update user-facing usage strings inside `runRalphCommand`.**
  These are printed by the loop when an ID is missing. They're still
  user-visible so AC3 applies; the spec's "no internal changes" carve-out
  is about loop logic, not error messages. Treated this the same as
  rewriting any other help text.
- **Removed the `feature-do --autonomous` row from the README Pro table**
  rather than rewriting it to `--iterate`. Per AC6 and the 2026-04-07
  product decision, `--iterate` is free. Leaving it in the Pro table would
  be a documentation lie.
- **Kept the `ralph-progress.md` filename and `ralph-iteration.txt`
  template name.** AC3 explicitly carved these out as internal. Renaming
  the progress file would also break resume of any in-flight loops.
- **Config alias map now treats `iterate` and `autonomous` as aliases for
  the same `ralph` storage key.** No deprecation warnings — silent
  fallbacks per AC4.

## Validation

- `node -c` on every touched JS file: pass.
- `npm test`: 9 test files green (incl. new `iterate-flag-rename.test.js`).
- `MOCK_DELAY=fast npm run test:ui`: 8/8 dashboard E2E green.
- `bash scripts/check-test-budget.sh`: 1990 / 2000 LOC.
- Manual smoke (per AC7):
  - `node aigon-cli.js feature-do 1 --autonomous` → `❌ --autonomous/--ralph
    was renamed to --iterate on 2026-04-07.` + hint, exit 1.
  - `node aigon-cli.js feature-do 999 --ralph` → same hint, exit 1.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-07

### Findings
- The rename sweep missed four user-facing references outside historical records: `docs/specs/templates/feature-template.md`, `templates/specs/feature-template.md`, `docs/aigon-project.md`, and `docs/architecture.md` still said "Ralph/autonomous" after the feature renamed the flag to `--iterate`.

### Fixes Applied
- `1a104199` — `fix(review): complete iterate rename sweep in docs and templates`

### Notes
- No code-path or behavior issues found in the `feature-do` flag handling itself during review; the only issue was incomplete doc/template coverage against AC3.
