---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-27T23:30:24.660Z", actor: "cli/research-prioritise" }
---

# Research: Skill vs Command Format Evolution

## Context

Aigon supports six AI coding agents (Claude Code, Cursor, Gemini, Codex, OpenCode, Kimi) and delivers workflow instructions to them in two formats:

- **Commands**: full markdown playbooks (50–100+ lines) installed into each agent's command directory (e.g. `.claude/commands/aigon/`). These contain step-by-step guidance, decision rubrics, guardrails, and next-step suggestions. The agent reads the entire document as a prompt before/during execution.
- **Skills**: a single YAML manifest (`skill.md`) listing tool entries with a one-line description and a CLI command string. Agents that consume this format (Codex, OpenCode, Kimi) see what they can call but get minimal guidance on how to think about the work.

This split was designed when agent tool-use capabilities varied widely. Since then, the industry has evolved significantly:
- Claude Code introduced custom slash commands, then skills (SKILL.md with system_prompt)
- Cursor added .mdc rules and command files
- Codex adopted `.agents/skills/` with YAML metadata
- OpenAI Codex, Google Jules/Gemini CLI, and others have introduced their own instruction formats
- The MCP protocol has standardised tool discovery across agents
- Agent "system prompt" and "rules" mechanisms have matured, blurring the line between "tool I can call" and "instructions I should follow"

The question is whether Aigon's current two-format approach still optimally serves its two goals:
1. **Workflow adherence** — agents follow the Aigon lifecycle (create → prioritise → start → do → eval → close) correctly, with proper state transitions, commits, and handoffs.
2. **Software quality** — agents produce the best possible implementation by exploring the codebase first, understanding constraints, setting appropriate complexity, and following project conventions.

Skill-only agents currently get neither the workflow guardrails nor the quality-driving prompts that command-format agents receive. This may be a meaningful quality gap.

## Questions to Answer

- [ ] What instruction formats do each of Aigon's supported agents (cc, cu, gg, cx, op, km) actually consume today? Have any gained new capabilities since Aigon's format was designed?
- [ ] How do other multi-agent orchestrators (Goose, Amplify, Relay, etc.) deliver workflow instructions to heterogeneous agents? Is there an emerging standard?
- [ ] What is the current industry understanding of "skills" vs "commands" vs "rules" vs "system prompts" — are these converging or diverging?
- [ ] For skill-format agents: does the thin YAML manifest measurably hurt workflow adherence or output quality compared to command-format agents? (Review existing eval data if available)
- [ ] Could the `system_prompt` block in `skill.md` carry the key workflow guidance that commands provide? What are the token/context limits for each agent's system prompt ingestion?
- [ ] Should Aigon auto-generate skill entries from command templates (extracting key guidance into structured fields) rather than maintaining them separately?
- [ ] Is MCP tool discovery a viable alternative or complement to file-based skill manifests?
- [ ] What is the minimal set of instructions a skill-only agent needs to match command-agent quality on workflow adherence and software output?

## Scope

### In Scope
- All six agents Aigon currently supports and their instruction-consumption mechanisms
- Industry trends in agent instruction formats (2025–2026)
- The two Aigon delivery formats: `templates/generic/commands/*.md` and `templates/generic/skill.md`
- The `system_prompt` field in skill.md and its potential for expansion
- Auto-generation feasibility (command → skill transformation)
- Impact on the two optimisation goals (workflow adherence + software quality)

### Out of Scope
- Changing the Aigon workflow lifecycle itself (create/prioritise/start/do/eval/close)
- Agent-specific bugs or implementation issues unrelated to instruction format
- MCP server implementation details (only MCP as a discovery mechanism)
- Pricing or token cost optimisation (focus on quality, not cost)

## Findings

## Recommendation

## Output
- [ ] Feature:
