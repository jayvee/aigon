# Research Findings: simplify command parameters

**Agent:** Codex (cx)
**Research ID:** 03
**Date:** 2026-02-10

---

## Key Findings

1. Agent support for nested/subcommand UX is uneven, but a router pattern is feasible everywhere.

| Agent | Native custom command shape | Subcommand / nesting support | Parameter hint support | Router viability |
|---|---|---|---|---|
| Claude Code | Markdown commands in `.claude/commands` | Subdirectories are allowed but do not change command name; no true nested routing model for custom commands | `argument-hint` frontmatter + `{{args}}` templating | High |
| Gemini CLI | Markdown commands in `.gemini/commands` | Supports namespaced commands via subdirectories (`/git:commit`); built-in commands also have subcommands (`/chat save`) | `$ARGUMENTS`, `$1..$9` | High |
| Codex CLI | Custom prompts/skills; slash command namespace patterns like `/prompts:<name>` (legacy) and `/skills` discovery | Legacy custom prompts are namespace-based and top-level only (no subdirs); no true nested tree for custom prompts | Markdown frontmatter `args` (legacy custom prompts) | Medium-High |
| Cursor | Markdown commands in `.cursor/commands` | No documented nested custom command routing; community support thread indicates nested commands are not supported yet | No clear documented argument-hint schema in official docs | Medium |

2. A single `/aigon` command is technically possible only as a prompt-level parser, not a native cross-agent subcommand tree.
- You can implement `/aigon <domain> <action> ...` by parsing first tokens in prompt instructions and branching logic.
- This is portable, but discoverability drops because the slash menu only shows one entry and users must memorize subcommands.

3. A hybrid router is the strongest cross-agent fit.
- Recommended top-level commands: `/aigon-feature`, `/aigon-research`, keep `/aigon-help` explicit.
- This reduces menu clutter while preserving domain discoverability and keeping prompt files manageable.

4. Current Aigon generator constraints support hybrid better than full single-router.
- Local code currently emits one file per command from `templates/generic/commands/*.md` (18 files).
- `aigon-cli.js` adds Codex `args` frontmatter as a fixed value (`feature_id`) for all commands, which is too coarse for richer guided input.

5. Inference on actual pain point from repo state and agent UX docs:
- Primary pain is menu clutter + cognitive scan cost (18 similarly-prefixed entries), not just command-name length.
- Secondary pain is inconsistent argument guidance across agents.

## Sources

- Claude Code docs, slash command arguments and discovery: https://docs.anthropic.com/en/docs/claude-code/slash-commands
- Claude Code docs, skills (current customization model): https://docs.anthropic.com/en/docs/claude-code/skills
- Gemini CLI docs, commands reference (shows built-in subcommands like `/chat save`): https://google-gemini.github.io/gemini-cli/docs/cli/commands/
- Gemini CLI docs, custom commands (`$ARGUMENTS`, positional args, namespaced commands): https://google-gemini.github.io/gemini-cli/docs/core/custom-commands/
- Codex docs, CLI slash commands (`/help`, `/model`, `/review`, `/approval` etc.): https://developers.openai.com/codex/cli
- Codex docs, customization + skills: https://developers.openai.com/codex/customization
- Codex docs, skills directory and invocation: https://developers.openai.com/codex/skills
- Codex repo docs (legacy custom prompts namespace `/prompts:<name>`, top-level prompt dir, `args` frontmatter): https://raw.githubusercontent.com/openai/codex/main/docs/prompts.md
- Cursor docs, custom modes/commands entry point: https://docs.cursor.com/chat/custom-modes
- Cursor docs, slash commands and command files in `.cursor/commands`: https://cursor.com/changelog/slash-commands
- Cursor forum thread (staff confirmation that nested commands are not supported): https://forum.cursor.com/t/custom-slash-commands-in-sub-folders/67421

## Recommendation

Adopt a **hybrid command consolidation** strategy:

- Phase 1: Consolidate to 3 explicit entry points:
  - `/aigon-feature <action> ...`
  - `/aigon-research <action> ...`
  - `/aigon-help`
- Phase 2: Add lightweight in-command router logic for `<action>` within each domain command, with strict validation + fallback usage text.
- Phase 3: Improve per-agent argument guidance (Codex/Claude frontmatter, Gemini positional guidance, Cursor inline usage examples).

Why this over a single `/aigon`:
- Better cross-agent reliability with current platform constraints.
- Keeps slash-menu discoverability for major domains.
- Avoids one massive, brittle prompt that must encode all workflows.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| command-router-hybrid | Replace flat command set with domain-level router commands (`aigon-feature`, `aigon-research`, `aigon-help`) that dispatch by first argument. | high | none |
| router-action-validation | Add shared validation/error messaging so unknown subcommands return canonical usage and examples consistently across agents. | high | command-router-hybrid |
| cross-agent-arg-guidance | Standardize argument hints per agent format (Claude `argument-hint`, Codex `args`, Gemini `$ARGUMENTS` docs, Cursor inline usage block). | medium | command-router-hybrid |
| codex-skills-compat-layer | Add optional Codex skills generation path so teams can move from legacy `/prompts:*` to skills without breaking existing commands. | medium | command-router-hybrid |
| command-menu-usage-metrics | Instrument local command usage telemetry (or lightweight logs) to validate whether consolidation actually improves discoverability. | low | command-router-hybrid |
