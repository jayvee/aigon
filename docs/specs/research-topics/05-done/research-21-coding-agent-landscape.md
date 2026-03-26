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

### Agent Participation
- **cc (Claude Code):** Full findings — comprehensive research covering 9 CLI agents, benchmarks, pricing, context delivery, and role-specific assessment
- **gg (Gemini CLI):** No findings submitted (empty template)

### Key Findings (from cc, March 2026)

1. **Top 3 current agents have converged:** cc (80.8%), gg (80.6%), cx (80.0%) on SWE-bench Verified — within 0.8%. Model quality is no longer the differentiator; context delivery, tooling, and cost drive the difference.

2. **Two strong new candidates identified:**
   - **GitHub Copilot CLI** — GA (Feb 2026), multi-model, built-in Fleet parallelism, $10/mo flat, tmux support, `copilot -p --autopilot` headless mode
   - **Goose (Block)** — Free/OSS, model-agnostic, recipe system for context, `goose run -t` headless mode

3. **Agents deferred:** Cline CLI (too new, Feb 2026), Auggie (proprietary/expensive), Cursor CLI (beta), Aider (no auto-context, unreliable shell)

4. **Not viable:** Windsurf (IDE-only), Devin (cloud-only), SWE-agent (research tool), Mentat (declining), Sweep (archived)

5. **cx model opportunity:** GPT-5.4 available as implementation model upgrade from GPT-5.3-Codex ($1.75 → $2.50/MTok input)

See `docs/specs/research-topics/logs/research-21-cc-findings.md` for full details including pricing tables, context delivery comparison, and benchmark data.

## Recommendation

### Keep current agents, expand the Fleet with a pluggable registry

The current agents (cc, gg, cx) are all competitive — no replacements needed. The priority is:

1. **Role-specific agent config** — Let each agent declare what it's good at (implement, evaluate, research, review) so Fleet assignments are intentional, not assumed
2. **Pluggable agent registry** — Remove all hardcoded agent IDs so new agents can be added via a single config file. Include initial configs for Copilot CLI (`gh`) and Goose (`gs`)
3. **Model config update** — Bump cx from GPT-5.3-Codex to GPT-5.4 for implementation

This approach maximizes Fleet diversity while keeping the system maintainable — one JSON file per agent, no source code changes to add new members.

## Output

### Selected Features

| Feature Name | Description | Priority | Spec |
|--------------|-------------|----------|------|
| role-specific-agent-config | Role declarations in agent config (implement, evaluate, research, review) | high | `docs/specs/features/01-inbox/feature-role-specific-agent-config.md` |
| pluggable-agent-registry | Data-driven agent registry + Copilot CLI and Goose configs | high | `docs/specs/features/01-inbox/feature-pluggable-agent-registry.md` |
| model-config-update-cx | Update cx implement model to gpt-5.4 | low | `docs/specs/features/01-inbox/feature-model-config-update-cx.md` |

### Feature Dependencies

- pluggable-agent-registry depends on role-specific-agent-config (needs the `roles` field in the config schema)

### Not Selected

- agent-benchmark-tracking: Useful but lower priority — can be added after the registry exists
- context-delivery-audit: Good idea but better done as part of each agent integration
- monitor-cline-cli: Monitoring task, not a feature — re-evaluate in Q3 2026
- monitor-cursor-cli: Monitoring task — re-evaluate when Cursor CLI reaches GA
