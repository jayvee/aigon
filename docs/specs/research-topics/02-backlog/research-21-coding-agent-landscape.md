# Research: Coding Agent Landscape

## Context

Aigon's Fleet mode runs multiple coding agents in parallel on the same feature, then evaluates and picks the best implementation. Currently we have three active agents: cc (Claude Code), gg (Gemini CLI), and cx (Codex/OpenAI). We tested mv (Mistral Vibe/Devstral) and it scored 25-28/40 vs gg's 32-38/40 across two features — not competitive enough due to shallow spec adherence and lack of context delivery (no slash commands, hooks, or rules).

The coding agent landscape evolves rapidly. New CLIs, models, and autonomous modes appear monthly. This research should be **run periodically** (quarterly or when major new agents/models launch) to ensure aigon uses the best available agents.

**Key insight from mv experiment:** Agents don't need to be good at everything. An agent could be excellent at implementation but poor at evaluation or research. Aigon should support **role-specific agent assignments** — e.g., an agent used only for Fleet implementation but never for eval or research.

## Questions to Answer

- [ ] What coding agent CLIs currently exist with headless/autonomous modes? (Aider, Amazon Q, Augment, Devin CLI, Copilot CLI, Windsurf CLI, Cursor CLI, etc.)
- [ ] For each agent: does it support slash commands, context files, hooks/rules, or similar structured context delivery?
- [ ] For each agent: what is the CLI invocation for autonomous/headless mode? (equivalent of `claude -p`, `gemini --yolo`, `vibe -p`)
- [ ] For each agent: what models does it use, and can the model be overridden?
- [ ] For each agent: what is the pricing model? (per-seat, per-token, free tier, API costs)
- [ ] For each agent: what are its SWE-bench Verified scores or other benchmark results?
- [ ] Which agents show strong implementation quality but may not be suited for evaluation or research? (role-specific strengths)
- [ ] Which agents can run shell commands autonomously? (required for `aigon agent-status`, `aigon feature-do`, etc.)
- [ ] Are there any agents that work purely via API/model and could be wrapped by aigon directly (skip the CLI, call the model with a system prompt)?
- [ ] What new models have launched since last review that could improve existing agents? (e.g., new Gemini, Claude, GPT versions that cx/gg/cc should switch to)

## Scope

### In Scope
- CLI-based coding agents that can run headlessly in a terminal/tmux session
- Agents that can execute shell commands (required for aigon integration)
- Pricing comparison for overnight batch usage (10-50 features/month)
- Role-specific assessment: implementation vs evaluation vs research capability
- Model updates for existing agents (cc, gg, cx)
- Assessment of context delivery mechanisms (how does each agent receive instructions?)

### Out of Scope
- IDE-only agents with no CLI (e.g., pure VS Code extensions)
- Agents that require GUI interaction
- Building custom agents from scratch (that's a separate feature)
- Detailed integration work — this research identifies candidates, separate features handle integration

## Recurring Schedule

This research should be re-run:
- **Quarterly** as a baseline sweep
- **Ad-hoc** when a major new agent or model is announced
- **After each integration attempt** (like the mv experiment) to update findings

When re-running, update the Findings section with dated entries rather than overwriting, so we can track the landscape over time.

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature: role-specific agent assignments (implementation-only, eval-only agents)
- [ ] Feature: integrate top-scoring new agent (TBD from findings)
