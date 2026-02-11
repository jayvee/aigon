# Research: simplify-command-parameters

## Context

Aigon currently has **18 slash commands** per agent, and this number grows with every new feature. The flat namespace (`/aigon-feature-create`, `/aigon-feature-setup`, `/aigon-research-conduct`, etc.) is becoming unwieldy — both for discoverability and for the agent's slash command menu.

The question: could we consolidate to fewer top-level commands that accept subcommands as parameters? For example:

```
# Instead of 18 separate commands:
/aigon-feature-create dark-mode
/aigon-feature-setup 55 cc gg
/aigon-research-conduct 05

# Could we have 2-3 top-level commands with subcommands:
/aigon-feature create dark-mode
/aigon-feature setup 55 cc gg
/aigon-research conduct 05

# Or even a single entry point:
/aigon feature create dark-mode
```

### Current State
- 18 template files in `templates/generic/commands/`
- Each generates an agent-specific slash command for all 4 agents (cc, gg, cx, cu)
- Agents discover commands via filesystem scan — flat directory, one file per command
- No agent currently supports subcommand nesting natively
- Only Codex supports parameter hints (`args: feature_id` in frontmatter)

## Questions to Answer

- [x] Do any of the four supported agents (Claude Code, Gemini CLI, Codex, Cursor) support subcommand-style slash commands or nested command routing? — **No native routing. CC and GG support subdirectory grouping (`:` separator). Codex and Cursor are flat only.**
- [x] Can we implement a single `/aigon` or `/aigon-feature` command that dispatches based on the first argument (e.g., `create`, `setup`, `implement`)? — **Technically yes via prompt-level parsing, but all agents discouraged it as unreliable and hurting discoverability.**
- [x] What UX patterns do agents support for parameter hints, autocomplete, or guided input that could help users discover subcommands? — **CC: `argument-hint` frontmatter. CX: `args` frontmatter. GG: `$1`-`$9` positional. CU: none.**
- [x] Would a "router" command that reads the first arg and delegates to the right prompt template work across all agents, or only some? — **Prompt-level routing works everywhere but is fragile. CLI-level routing (GG's proposal) would be robust but requires CLI changes.**
- [x] What is the actual user pain point — is it the number of commands in the menu, the length of command names, or something else? — **Menu clutter (18 similarly-prefixed flat commands) is the primary pain. Secondary: inconsistent argument guidance.**
- [x] Could we use a hybrid approach (e.g., `/aigon-feature` and `/aigon-research` as two top-level routers, keeping `/aigon-help`)? — **Yes, viable. Deferred for now in favor of incremental improvements that may be sufficient.**
- [x] What are the trade-offs of consolidation vs. the current explicit-command approach (discoverability, prompt size, agent compatibility)? — **Consolidation: cleaner menu but larger prompts, LLM dispatch risk, lost per-action autocomplete. Current: cluttered menu but reliable, focused prompts.**

## Scope

### In Scope
- Evaluating slash command capabilities of Claude Code, Gemini CLI, Codex, and Cursor
- Designing a consolidated command structure that works across all agents
- Investigating parameter hint / autocomplete / guided-input features per agent
- Assessing impact on the template generation pipeline in `aigon-cli.js`
- Considering a "router" pattern where one slash command dispatches to sub-prompts

### Out of Scope
- Changing the CLI commands themselves (`aigon feature-setup` etc.) — only the slash command UX
- Adding new agents beyond the current four
- MCP server approach (covered by separate research-plugin-distribution topic)
- Redesigning the template placeholder system

## Findings

Three agents (cc, gg, cx) independently researched this topic. Key discoveries:

1. **No agent supports native subcommand routing for custom commands.** Subdirectory nesting is supported by Claude Code and Gemini CLI (both use `:` separator), but not by Codex or Cursor.
2. **A single `/aigon` dispatcher is universally discouraged.** All agents agreed it produces brittle mega-prompts, relies on unreliable LLM arg-parsing, and removes per-action autocomplete.
3. **Menu clutter (18 flat commands) is the primary pain point**, not command name length or architecture.
4. **Aigon underutilizes existing agent features.** Claude Code supports `argument-hint`, `allowed-tools`, `disable-model-invocation` frontmatter — none are used. Codex `args` frontmatter is hardcoded to the same value for all commands.
5. **Three approaches were proposed** ranging from conservative (cc: reorganize files + add metadata) to ambitious (gg: CLI refactor + consolidated templates) with cx proposing a middle-ground hybrid router.

The approaches are layerable — starting with file reorganization and metadata doesn't prevent later consolidation into router commands if needed.

## Recommendation

**Start with incremental improvements (cc's approach), leaving the door open for consolidation later.**

Phase 1 (selected features below) addresses the primary pain with low-risk, no-regret changes:
- Subdirectory grouping for Claude Code to match Gemini's existing pattern
- Argument hints to improve per-command discoverability
- Safety frontmatter to prevent accidental invocation of destructive commands

If menu clutter remains a problem after Phase 1, the path to consolidated router commands (gg/cx approach) remains open — especially if CLI nested command support (`aigon feature create`) is added first to enable deterministic dispatch.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| command-subdirectory-grouping | Move Claude Code commands into `.claude/commands/aigon/` subdirectory to reduce menu clutter, matching Gemini's existing structure | high | `aigon feature-create "command-subdirectory-grouping"` |
| command-argument-hints | Add `argument-hint` frontmatter to templates for Claude Code and Codex with per-command parameter descriptions | medium | `aigon feature-create "command-argument-hints"` |
| command-safety-frontmatter | Add `disable-model-invocation: true` to destructive commands (feature-done, feature-cleanup, worktree-open) for Claude Code | medium | `aigon feature-create "command-safety-frontmatter"` |

### Feature Dependencies
- command-safety-frontmatter depends on command-subdirectory-grouping (reorganize first, then add metadata)

### Not Selected
- command-positional-args (cc): Low priority, CC-specific `$ARGUMENTS` syntax switch — can revisit later
- cli-nested-commands (gg): Valuable but requires CLI refactor — good Phase 2 candidate if routers are needed
- consolidated-slash-commands (gg, cx): Router approach — deferred pending Phase 1 results
- interactive-help-prompt (gg, cx): Only needed if router commands are adopted
- router-action-validation (cx): Only needed if router commands are adopted
- codex-skills-compat-layer (cx): Codex-specific, premature until skills API stabilizes
- command-menu-usage-metrics (cx): Nice-to-have, low priority
