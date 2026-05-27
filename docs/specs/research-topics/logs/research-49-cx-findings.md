# Research Findings: skill vs command format evolution

**Agent:** Codex (cx)
**Research ID:** 49
**Date:** 2026-05-28

---

## Key Findings

### 1. The research premise is partly stale on current `main`

Aigon no longer has a simple "command agents get playbooks, skill agents get only a thin manifest" split.

Current local behavior:

| Agent | Aigon output today | Runtime invocation path | Notes |
|---|---|---|---|
| `cc` Claude Code | `.claude/commands/aigon/*.md` plus `.claude/skills/aigon/SKILL.md` | Slash command string, e.g. `/aigon:feature-do {id}` | Full command playbooks are installed as slash commands. The extra aggregate skill is a legacy-looking tool manifest. |
| `cu` Cursor | `.cursor/commands/aigon-*.md` plus `.cursor/rules/aigon.mdc` | Slash command string, e.g. `/aigon-feature-do {id}` | Full command playbooks are installed. Cursor rules carry durable project guidance. |
| `gg` Gemini CLI | `.gemini/commands/aigon/*.toml` | Slash command string, e.g. `/aigon:feature-do {id}` | Full command playbooks are embedded in TOML `prompt` fields. |
| `cx` Codex | `.agents/skills/aigon-*/SKILL.md` | Non-slash: Aigon inlines canonical command body for spawned sessions | Interactive users can invoke per-command skills; Aigon-launched sessions bypass skill discovery and receive the full markdown body. |
| `op` OpenCode | `.opencode/commands/aigon-*.md` and `.agents/skills/aigon-*/SKILL.md` | TUI/prompt injection; also flat OpenCode commands | Feature 440 added dual output. |
| `km` Kimi | `.agents/skills/aigon-*/SKILL.md` | TUI injects `/skill:aigon-<verb> <id>` | Full per-command skill body exists, but runtime depends on Kimi skill resolution. |

Evidence from the repo:

- `templates/agents/*.json` declares `capabilities.resolvesSlashCommands`; `cc`, `cu`, and `gg` are true, while `cx`, `op`, and `km` are false.
- `lib/agent-prompt-resolver.js` explicitly says non-invocable agents do not rely on CLI command discovery for Aigon-spawned sessions; it reads `templates/generic/commands/*.md`, substitutes placeholders, strips metadata, and returns the full prompt body.
- Current installed command bodies are similar in size: `feature-do` is 126 lines for Claude, 126 for Gemini, 122 for Cursor, 126 for OpenCode, and 127 for `.agents/skills/aigon-feature-do/SKILL.md`.
- Feature 223 migrated Codex from deprecated `~/.codex/prompts/` to project-local `.agents/skills/aigon-*/SKILL.md` while preserving the inline Aigon launch path.
- Feature 440 added OpenCode multi-output: flat `.opencode/commands/aigon-*.md` as primary output and `.agents/skills/aigon-*/SKILL.md` as an additional skill tree.

The actual gap is narrower:

- The aggregate `templates/generic/skill.md` is still hand-maintained and thin.
- It is installed via Claude's `extras.skill` path, not as the primary command source for all skill agents.
- Its `tools:` plus `system_prompt:` shape is not the same as the current Agent Skills `SKILL.md` frontmatter/body convention.
- Mid-session nudges for non-slash agents often send a path pointer or a skill command rather than a native slash command; that relies on the agent reading the file correctly.
- Interactive usage can still drift if users call a skill/command outside the Aigon launch path and the installed artifact is stale or unsupported by the agent.

### 2. Agent instruction formats are converging on file-backed instructions, but invocation semantics still diverge

The major agent CLIs now all support some combination of:

- project memory/instructions: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Cursor rules
- reusable command files: slash commands or command palette entries
- reusable skills: `SKILL.md` directories with metadata plus markdown instructions
- external tools: MCP servers exposing tools, resources, and prompts

They are converging on "small metadata for discovery, full markdown loaded on demand." They are not converging on one invocation syntax.

Relevant primary-source details:

- Claude Code supports custom slash commands from markdown files under project `.claude/commands/` or user `~/.claude/commands/`. Claude Code skills are directories with a `SKILL.md`; Claude scans only names/descriptions at startup, then loads the full skill only when relevant.
- Anthropic's Agent Skills spec says a skill is a directory containing `SKILL.md` with YAML frontmatter (`name`, `description`) and markdown body. The spec recommends keeping `SKILL.md` under 500 lines and using progressive disclosure for larger assets.
- OpenAI Codex skills use the same progressive disclosure model. Codex scans project and user skills, keeps names/descriptions in context, loads `SKILL.md` when selected, and caps the aggregate skill list at about 2 percent of the context window or 8,000 characters.
- Cursor supports project rules under `.cursor/rules` and custom commands under `.cursor/commands`; current Aigon uses both.
- Gemini CLI supports custom slash commands in TOML files with `name`, `description`, and `prompt`, including project-local `.gemini/commands/`.
- OpenCode supports `.opencode/commands/*.md` for custom slash commands. It also documents skills that can bundle instructions and related files.
- Kimi CLI supports skills invoked with `/skill:<name>` and looks up the corresponding `SKILL.md`; Aigon's `km` path uses exactly that injection style.

The practical standard is therefore not "skills replace commands." It is:

1. A short manifest/frontmatter entry for discoverability.
2. A full markdown instruction body loaded only when invoked.
3. A separate persistent project-instructions file for global invariants.
4. Optional MCP tools/prompts for runtime actions and cross-agent surfaces.

### 3. Other orchestrators favor layered context, not one universal command format

Surveyed patterns:

- Goose uses extensions/tools plus recipes. Recipes are YAML files with instructions, activities, parameters, and optional sub-recipes. This resembles Aigon specs plus command templates more than a flat tool manifest.
- Amp uses `AGENTS.md`, skills, slash commands, and MCP. Its manual explicitly treats skills as bundles of instructions plus optional MCP/tooling, and recommends using MCP to avoid overloading the main context with long command descriptions.
- Claude Code subagents and skills separate durable instructions from tool permissions and task-specific invocation.
- Cursor and Gemini keep project rules/memory separate from command invocation.
- MCP standardizes tools/resources/prompts over a protocol, but it does not guarantee that every agent will use MCP prompts as its workflow instruction substrate.

No mature orchestrator appears to rely on a single universal "command manifest" as the only instruction carrier. The emerging pattern is layered:

- lifecycle state remains owned by the orchestrator
- command/skill artifacts invoke specific workflows
- project rules carry stable behavioral invariants
- MCP offers common tool discovery and remote integration where supported

### 4. There is no clean local A/B evidence that thin skills hurt quality, because current Aigon no longer launches thin skills

I found local benchmark data under `.aigon/benchmarks/` and many feature logs, but they do not isolate instruction format. They compare agents/models/runtimes on Brewboard tasks, so model quality, CLI reliability, tool behavior, and prompt delivery are confounded.

Examples:

- Claude (`cc`) runs on 2026-04-29 passed across Haiku/Sonnet/Opus variants in roughly 23-52 seconds.
- Gemini (`gg`) runs on 2026-05-10 and 2026-05-11 passed across multiple Gemini models in roughly 47-93 seconds.
- Cursor (`cu`) had a failed sweep on 2026-05-20, then passed later Composer sweeps in roughly 26-84 seconds.
- OpenCode (`op`) showed high variance, with some model passes and many model/runtime failures.

These results are useful for model/runtime reliability, not for "thin manifest vs full command body." The strongest local evidence is architectural:

- `cx`, `op`, and `km` have full per-command `SKILL.md` output.
- Aigon-spawned `cx`/`op` sessions inline command templates from `templates/generic/commands/`.
- Therefore the current primary launch path should not suffer the thin-manifest quality gap described in the brief.

The remaining measurable risks are:

- stale or malformed installed artifacts
- agent-specific failure to discover skills/commands
- path-pointer prompts being ignored during mid-session recovery/revision
- the aggregate `templates/generic/skill.md` drifting from `COMMAND_REGISTRY`
- missing smoke tests for interactive `$aigon-*`, `/aigon-*`, `/skill:aigon-*` invocation paths

### 5. `system_prompt` in `templates/generic/skill.md` should not become the main guidance carrier

`templates/generic/skill.md` currently contains:

```yaml
name: aigon
description: Aigon workflow.
tools:
  - name: aigon_feature_prioritise
    command: aigon feature-prioritise {{id}}
system_prompt: |
  You are the Aigon Manager...
```

This is not the portable Agent Skills shape used by Claude/Codex-style skills, which is YAML frontmatter plus markdown body. It is also too coarse-grained: putting every 50-180 line playbook into a single aggregate `system_prompt` would bloat baseline context and lose the progressive-disclosure benefit.

Use it, if retained, only for short invariants:

- "Aigon lifecycle commands are mandatory."
- "For feature implementation, stay in the assigned worktree/branch."
- "For research, write only your own findings file."
- "Never use broad staging; stage exact files."
- "Read `.aigon/docs/development_workflow.md` and `.aigon/docs/agents/<id>.md` when needed."

Do not use aggregate `system_prompt` as the canonical playbook store. The canonical source should remain `templates/generic/commands/*.md`, rendered into each agent's native command/skill format.

### 6. Auto-generation is the right direction

Aigon already effectively has the right source of truth: `templates/generic/commands/*.md` plus `COMMAND_REGISTRY` metadata. The weak point is that `templates/generic/skill.md` is hand-maintained and has a different schema from per-command skills.

Recommended generation model:

1. Keep `templates/generic/commands/*.md` as canonical playbooks.
2. Generate per-command artifacts for each agent output format:
   - Claude markdown slash command
   - Cursor markdown command
   - Gemini TOML command
   - OpenCode markdown command
   - Agent Skills `SKILL.md`
3. Generate any aggregate skill/tool index from `COMMAND_REGISTRY`, not by hand.
4. Add a drift test that checks command registry entries, installed skill/command names, descriptions, argument hints, and aliases agree.
5. Add per-agent smoke tests for the actual invocation form, not just file existence.

This preserves quality while reducing maintenance cost.

### 7. MCP is a complement, not a replacement

MCP is useful for Aigon as a standard action/discovery surface:

- list current features/research topics
- expose valid workflow actions from engine state
- run lifecycle actions through a controlled tool API
- expose specs, logs, dashboard status, transcripts, and recommendations as resources
- expose prompts for common workflows where the client supports MCP prompts

But MCP should not replace file-based command/skill installation yet:

- MCP support differs widely across supported agents.
- Some users rely on CLI-only sessions where local command/skill files are the ergonomic invocation surface.
- MCP tools can execute actions, but workflow adherence still needs agent-side instruction text.
- MCP prompt discovery is not as universally adopted as tools/resources.

The safer route is hybrid: keep native file artifacts for every agent and add an MCP server as a universal structured control plane.

### 8. Minimal instruction set for skill-only parity

A skill-only agent needs these invariants before doing work:

1. Resolve the active entity and verify workspace (`pwd`, branch/worktree, exact spec path).
2. Run the required lifecycle signal before work (`aigon agent-status implementing`, review variants, or research equivalents).
3. State the only allowed write targets for the mode.
4. Read the spec/brief and relevant project instructions before editing.
5. Follow repo-local conventions and avoid stack assumptions in target repos.
6. Use precise staging only; never broad-stage with `git add .` or `git add -A`.
7. Run scoped validation appropriate to the repo when implementing code.
8. Commit only owned files with the required message shape.
9. Run the required completion signal and require exit 0 before claiming completion.
10. For Fleet/review flows, do not run coordinator-only close/eval steps unless explicitly assigned.

These fit in a short shared invariant block. The task-specific details should stay in the per-command body.

## Sources

Web sources:

- Claude Code slash commands: https://code.claude.com/docs/en/slash-commands
- Claude Code skills: https://docs.claude.com/en/docs/claude-code/skills
- Agent Skills specification: https://agentskills.io/specification
- OpenAI Codex skills: https://developers.openai.com/codex/skills
- Cursor rules: https://docs.cursor.com/context/rules
- Cursor custom commands: https://docs.cursor.com/en/agent/chat/commands
- Gemini CLI custom commands: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/commands.md
- OpenCode commands: https://dev.opencode.ai/docs/commands
- OpenCode skills: https://dev.opencode.ai/docs/skills
- Kimi CLI skills: https://moonshotai.github.io/kimi-cli/en/customization/skills.html
- Goose recipes: https://block.github.io/goose/docs/guides/recipes/
- Amp manual: https://ampcode.com/manual
- Model Context Protocol concepts: https://modelcontextprotocol.io/docs/concepts

Local sources:

- `templates/generic/commands/*.md`
- `templates/generic/skill.md`
- `templates/generic/cursor-rule.mdc`
- `templates/agents/{cc,cu,gg,cx,op,km}.json`
- `lib/agent-prompt-resolver.js`
- `lib/templates.js`
- `lib/commands/setup.js`
- `lib/worktree.js`
- `docs/specs/features/logs/feature-223-cc-codex-skills-migration-log.md`
- `docs/specs/features/logs/feature-440-cc-opencode-slash-commands-output-log.md`
- `.aigon/benchmarks/all-brewboard-*.json`

## Recommendation

Treat `templates/generic/commands/*.md` as the canonical workflow playbook source and continue rendering it into each agent's native format. Do not move core guidance into the legacy aggregate `system_prompt`.

The best path is a "standard skill output v2":

- Keep full per-command `SKILL.md` files for `cx`, `km`, and the secondary `op` output.
- Keep native slash/command files for `cc`, `cu`, `gg`, and `op`.
- Generate all command/skill metadata from `COMMAND_REGISTRY` and template comments.
- Replace or deprecate the hand-maintained aggregate `templates/generic/skill.md`; if retained for Claude discovery, convert it to a valid standard skill with a short invariant body and generated tool index.
- Add smoke tests that exercise real invocation paths for every agent family.
- Add MCP as a complementary structured API after the file artifacts are drift-proof.

This keeps workflow adherence strong, avoids context bloat, respects each agent's native UX, and removes the main maintenance hazard: format drift.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| instruction-format-capability-audit | Add a checked-in capability matrix and regression test for each supported agent's command, skill, rules, and MCP support. | high | none |
| standard-skill-output-v2 | Normalize generated `SKILL.md` output to the current Agent Skills frontmatter/body convention and document supported fields. | high | instruction-format-capability-audit |
| command-registry-skill-index-generation | Generate aggregate skill/tool indexes from `COMMAND_REGISTRY` instead of maintaining `templates/generic/skill.md` by hand. | high | standard-skill-output-v2 |
| lifecycle-invariant-skill-block | Add a short generated invariant block covering workspace checks, lifecycle signals, file ownership, staging, and completion gating. | high | standard-skill-output-v2 |
| per-agent-invocation-smoke-tests | Add smoke tests that verify installed commands or skills resolve through each agent's actual invocation syntax. | high | standard-skill-output-v2 |
| instruction-format-ab-benchmark | Build a controlled benchmark comparing inline command body, per-command skill, aggregate skill, and MCP prompt delivery on the same task/model. | medium | per-agent-invocation-smoke-tests |
| aigon-mcp-control-plane | Expose Aigon status, specs, valid actions, and lifecycle commands through MCP as a complement to file-based commands. | medium | command-registry-skill-index-generation |
| mid-session-nudge-hardening | Replace non-slash path-pointer nudges with generated, agent-specific invocation prompts plus verification that the target file exists. | medium | per-agent-invocation-smoke-tests |
