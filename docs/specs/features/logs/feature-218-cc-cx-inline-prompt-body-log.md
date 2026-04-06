# Implementation Log: Feature 218 - cx-inline-prompt-body
Agent: cc

## Plan
Stop depending on codex's broken `/prompts:` slash-command discovery. Read the
canonical command template inline at launch time and pass the markdown body
directly to codex as the initial prompt argument.

## Progress
- Added `lib/agent-prompt-resolver.js` exposing `resolveAgentPromptBody({
  agentId, verb, featureId, extraArgs, cliConfig })`. Default branch returns
  the legacy slash-command string with `{featureId}` substituted (cc/gg/cu
  unchanged). The cx branch reads `templates/generic/commands/feature-<verb>.md`,
  runs `processTemplate` with the cx + active-profile placeholder set (with
  `ARG_SYNTAX` / `ARG1_SYNTAX` overridden to the real values), strips the
  `<!-- description -->` comment plus any defensive YAML frontmatter, and
  returns the trimmed body.
- Wired the resolver into `lib/commands/feature.js`:
  - `feature-do` launch site (~L1208) — was `cliConfig.implementPrompt.replace(...)`.
  - `feature-eval` launch site (~L1464) — was building `evalPrompt` inline.
- Wired into `lib/worktree.js#buildRawAgentCommand`. For non-cx agents the
  prompt is still embedded directly in the shell command. For cx the body is
  written to `os.tmpdir()/aigon-cx-prompts/<repo>/<entity>-<id>-<verb>.md`
  via the new `_writeCxPromptFile` helper, and the shell command references it
  with the bash `$(< file)` form. That form pulls file contents in as a single
  argv arg without re-evaluating any `$`/backticks inside, which matters
  because the inlined markdown body is multi-KB and contains both.
- Simplified `templates/agents/cx.json`: `implementPrompt`/`evalPrompt`/
  `reviewPrompt` now hold plain verb identifiers (`feature-do`, `feature-eval`,
  `feature-review`) instead of `/prompts:aigon-...` strings. The resolver
  ignores those fields for cx (it derives the template path from the verb),
  so the change is purely cosmetic but removes the misleading `/prompts:`
  literal from the repo.
- Added `tests/integration/agent-prompt-resolver.test.js` covering: cc
  passthrough, extraArgs propagation, cc fallback to `implementPrompt` when
  `reviewPrompt` is missing, cx sentinel line, frontmatter stripping,
  `$ARGUMENTS` / `$1` substitution, eval extra-args, and unknown-verb error.
- Wired the new test into the `npm test` script.
- Updated `CLAUDE.md` Module Map to list `lib/agent-prompt-resolver.js`.
- `install-agent cx` is unchanged: it still writes
  `~/.codex/prompts/aigon-feature-*.md` for users who want to invoke prompts
  manually if their codex version supports discovery. The runtime launcher
  no longer relies on that discovery working.

## Decisions

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-06

### Findings
- Architecture docs were incomplete for this change: `lib/agent-prompt-resolver.js` and the new cx inline-prompt launch path were added, but only `CLAUDE.md` was updated. Repo rules require architecture-facing docs to ship with module/pattern changes.

### Fixes Applied
- Updated `AGENTS.md` and `docs/architecture.md` to document `lib/agent-prompt-resolver.js` and the cx inline prompt-resolution path.

### Notes
- No additional functional issues found in the prompt resolver, feature launch wiring, or worktree launch path during this review.
- **Why a separate module instead of inlining in `lib/commands/feature.js`:**
  the resolver is consumed from both `lib/commands/feature.js` (CLI launch
  path) and `lib/worktree.js` (tmux/dashboard launch path). A standalone
  module avoids a `commands/feature.js → worktree.js` cycle and is trivially
  unit-testable without booting the workflow engine.
- **Why `$(< file)` instead of a heredoc or `--prompt-file` flag:**
  codex has no `--prompt-file` flag. A heredoc is fragile if the body
  happens to contain the chosen marker. Bash's `$(< file)` form reads the
  file contents verbatim into the command-substitution result without any
  further shell expansion of the file's bytes — exactly what we need.
- **Why override `ARG_SYNTAX` / `ARG1_SYNTAX` in the placeholder set instead
  of post-processing `$ARGUMENTS` / `$1`:** doing it through the existing
  `processTemplate` pipeline keeps the cx codepath identical in shape to
  what `install-agent cx` does — the only difference is which values those
  two placeholders receive. Less drift, fewer regex passes.
- **Why keep `install-agent cx` writing `~/.codex/prompts/`:** harmless,
  forward-compatible if codex ever fixes discovery, and out of scope for a
  contained launcher fix.
