# Research Findings: simplify command parameters

**Agent:** Claude (cc)
**Research ID:** 03
**Date:** 2026-02-11

---

## Key Findings

1. Agent support for subcommand nesting is split 2/4. No agent supports native in-command dispatch.

| Capability | Claude Code | Gemini CLI | Codex | Cursor |
|------------|------------|------------|-------|--------|
| Subdirectory nesting | YES (`:` separator) | YES (`:` separator, aigon already uses it) | NO (flat only, [rejected](https://github.com/openai/codex/issues/3707)) | NO (flat only) |
| Argument hints | `argument-hint` frontmatter | None for TOML commands | `argument-hint` frontmatter | None |
| Positional args | `$ARGUMENTS`, `$1`-`$9` | `{{args}}` only | `$ARGUMENTS`, `$1`-`$9`, named `$KEY=value` | None |
| Native dispatch/routing | No | No | No | No |
| Rich frontmatter | description, argument-hint, allowed-tools, model, disable-model-invocation | description only (TOML) | description, argument-hint | None (plain md) |

2. **A single `/aigon` dispatcher is not recommended.** Combining 11 feature commands into one prompt produces 500+ lines. LLM-interpreted "if arg1 is 'create'" branching is unreliable and defeats autocomplete/discoverability.

3. **Subdirectory grouping already works for Gemini** (`.gemini/commands/aigon/` -> `/aigon:*`). Claude Code can do the same (`.claude/commands/aigon/` -> `/project:aigon:*`). This is a one-line config change.

4. **Aigon underutilizes frontmatter.** Claude Code supports `argument-hint`, `allowed-tools`, `disable-model-invocation` — none are used. Codex supports `argument-hint` — only `args: feature_id` is emitted (hardcoded, same for all commands).

5. **Aigon uses `{{args}}` for CC, but CC natively supports `$ARGUMENTS`/`$1`/`$2`.** Positional args would help multi-param commands like `feature-setup <ID> [agents...]`.

6. **The real pain is menu clutter and discoverability** (18 flat commands), not architecture. Subdirectory grouping for CC (matching GG) addresses this immediately.

7. **Claude Code merged skills and commands in v2.1.3 (Jan 2026).** Skills offer subagents, supporting files, richer frontmatter. Converting is CC-only and premature for a multi-agent system.

## Sources

- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands) | [Skills Docs](https://code.claude.com/docs/en/skills)
- [Skills/Commands Merge (Jan 2026)](https://medium.com/@joe.njenga/claude-code-merges-slash-commands-into-skills-dont-miss-your-update-8296f3989697)
- [Nested directory issues](https://github.com/bmad-code-org/BMAD-METHOD/issues/773)
- [Gemini CLI Custom Commands](https://geminicli.com/docs/cli/custom-commands/) | [Google Cloud Blog](https://cloud.google.com/blog/topics/developers-practitioners/gemini-cli-custom-slash-commands)
- [Gemini CLI Issue #11463 - Markdown support request](https://github.com/google-gemini/gemini-cli/issues/11463)
- [Codex Custom Prompts](https://developers.openai.com/codex/custom-prompts/) | [Codex Slash Commands](https://developers.openai.com/codex/cli/slash-commands/)
- [Codex Issue #3707 - Subdirectories rejected](https://github.com/openai/codex/issues/3707) | [PR #3565 - argument-hint](https://github.com/openai/codex/issues/2890)
- [Cursor Slash Commands](https://ezablocki.com/posts/cursor-slash-commands/) | [PlanetScale - Cursor Commands](https://planetscale.com/blog/automating-with-cursor-commands)

## Recommendation

**Don't build a router. Improve what exists with three incremental changes:**

1. **Subdirectory grouping for Claude Code** (high priority, low effort): Change `cc.json` `commandDir` from `.claude/commands` + prefix `aigon-` to `.claude/commands/aigon` + no prefix. Matches Gemini's existing pattern. One config change, zero template changes.

2. **Add `argument-hint` frontmatter** (medium priority, low effort): Add per-command hints for CC and CX (e.g., `<feature-name>` for create, `<ID> [agents...]` for setup). Requires a new metadata field in templates and an update to `formatCommandOutput()`.

3. **Add `disable-model-invocation` for destructive commands** (medium priority, low effort): Prevent Claude from autonomously triggering `feature-done`, `feature-cleanup`, `worktree-open`. CC-only frontmatter, no impact on other agents.

**Why NOT a router:** In-command dispatch relies on LLM interpretation of "if first arg is X, do Y" — this is unreliable, produces massive prompts, and removes per-action autocomplete. The `aigon` CLI already serves as the real router.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| command-subdirectory-grouping | Move Claude Code commands into `.claude/commands/aigon/` subdirectory to reduce menu clutter, matching Gemini's existing structure | high | none |
| command-argument-hints | Add `argument-hint` frontmatter to templates for Claude Code and Codex with per-command parameter descriptions | medium | none |
| command-safety-frontmatter | Add `disable-model-invocation: true` to destructive commands (feature-done, feature-cleanup, worktree-open) for Claude Code | medium | command-subdirectory-grouping |
| command-positional-args | Switch Claude Code argument syntax from `{{args}}` to `$ARGUMENTS`/`$1`/`$2` for multi-parameter commands | low | none |
