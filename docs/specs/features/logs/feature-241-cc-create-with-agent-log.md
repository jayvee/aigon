---
commit_count: 5
lines_added: 300
lines_removed: 19
lines_changed: 319
files_touched: 7
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 103
output_tokens: 22306
cache_creation_input_tokens: 140850
cache_read_input_tokens: 7096068
thinking_tokens: 0
total_tokens: 7259327
billable_tokens: 22409
cost_usd: 14.9595
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 241 - create-with-agent
Agent: cc

## Plan

Add `--agent <id>` to `aigon feature-create` that launches the named agent
interactively with a pre-loaded drafting context, so the user can draft a
feature spec collaboratively instead of one-shot. Stay within the 2000-line
test budget.

## Progress

- Added `templates/prompts/feature-draft.md` — drafting context template
  with `{{SPEC_PATH}}` and `{{DESCRIPTION}}` placeholders.
- Added `lib/feature-draft.js` — `draftSpecWithAgent(specPath, agentId, description)`:
  looks up the agent via `agent-registry`, verifies the CLI binary is on PATH,
  hashes the spec file before launch, spawns the agent with `stdio: 'inherit'`,
  hashes again after, and warns if the file is unchanged (AC8). Unsets
  CLAUDECODE when spawning `claude` so nested-session errors don't fire.
- Rewrote the `feature-create` handler arg parser in `lib/commands/feature.js`
  to extract `--agent` and `--description` flags in any position, with the
  remaining positional words becoming the description. Validates agent id
  against `agentRegistry.getAllAgentIds()` and requires a description when
  `--agent` is set (AC5). Preserves the back-compat warning for stranded
  args before `--description`.
- Made `entity.entityCreate` return the built spec result so the caller can
  chain off the filePath.
- Updated `tests/integration/worktree-config-isolation.test.js` to add
  source-level regression checks: `--agent` routes to `draftSpecWithAgent`,
  positional parser still works (`positional.join(' ')`), and
  `lib/feature-draft.js` uses `spawnSync` with `stdio: 'inherit'`. The edit
  brings the total test-suite LOC to exactly 2000/2000 — at the ceiling.
- End-to-end smoke: created a throwaway repo, ran
  `feature-create smoke-ok --agent cc "a short description"` — spec was
  created, Claude Code launched with the context message as the opening
  turn, and started asking clarifying questions as designed.
- Negative paths verified: unknown agent id errors cleanly; `--agent` with
  no description errors cleanly; when the agent runs non-interactively (no
  TTY) and doesn't write the file, the AC8 "not modified" warning fires.

## Decisions

- **No new `interactiveLaunch` block in agent JSON configs.** Every agent
  CLI we support already accepts a positional prompt as its first argument
  — reusing that uniform invocation keeps the change minimal and avoids a
  config-schema expansion. The spec's optional fallback ("copy this prompt
  into your agent" for agents that can't pre-load) is unneeded today.
- **No flag tokens at launch time.** Drafting is not implementation, so
  none of the `implementFlag` tokens (autonomous, --permission-mode,
  etc.) apply. We launch the binary with just the context message and
  let the user's terminal drive the session.
- **`stdio: 'inherit'` and no timeout.** The user is the conversation
  driver; aigon's job is to open the door and check the spec file
  afterwards via hash compare.
- **Arg parser rewrite over surgical patch.** The legacy parser used
  `args.slice(1)` to grab the description, which would have wrongly
  swallowed `--agent cc`. Rewrote it to extract known flags first, then
  join remaining positional words — works equivalently whether `--agent`
  is leading, trailing, or interleaved.
- **Regression test in the existing catch-all file.** Rather than adding
  a new test file (would blow the 2000-LOC ceiling by ~15 lines), added
  three lines to `worktree-config-isolation.test.js` which is already
  acting as the source-level regression catch-all for feature-create.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-08

### Findings
- Post-session success output did not report which spec sections were populated, so AC7 was only partially implemented.

### Fixes Applied
- `0d0eccc0` — `fix(review): report populated spec sections after drafting`

### Notes
- Review was limited to targeted code inspection and minimal fixes. Tests were not run per the review workflow.
