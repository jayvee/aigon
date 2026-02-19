# Research: Models for Research

## Context

Currently, Aigon has no model configuration. When an agent is launched (e.g., `claude --permission-mode acceptEdits "/aigon:feature-implement 55"`), it uses whatever model the user has configured globally for that CLI tool. The same model is used regardless of whether the agent is doing research exploration, feature implementation, code review, or feature evaluation.

Different task types have fundamentally different cognitive requirements:
- **Research exploration**: breadth of knowledge, creative association, summarisation, comparison
- **Feature implementation**: precise code generation, instruction following, tool use, attention to detail
- **Code review / feature-eval**: critical analysis, pattern recognition, conciseness
- **Feature review (fix-based)**: a blend of implementation precision and critical analysis

Model providers already differentiate their offerings along these lines (e.g., Claude Opus for complex reasoning, Claude Sonnet for speed and cost, Claude Haiku for lightweight tasks). Aigon's multi-agent architecture — with distinct `buildAgentCommand()` and `buildResearchAgentCommand()` functions — already separates these code paths, making model selection a natural extension point.

Examples - gpt5.2 xhigh could be a good research judge.

### Current architecture

Key code paths where model selection could be injected:

- `buildAgentCommand(wt)` — builds the CLI command for feature implementation (line ~975 in `aigon-cli.js`)
- `buildResearchAgentCommand(agentId, researchId)` — builds the CLI command for research (line ~992)
- Agent config in `templates/agents/<id>.json` — has `cli.command` and `cli.implementFlag` but no model field
- `getAgentCliConfig(agentId)` — returns CLI config per agent

None of these currently accept or pass a `--model` flag.

## Questions to Answer

- [ ] Do different models actually perform measurably better at different task types (research vs implementation vs review)? What evidence exists from benchmarks, user reports, or Aigon's own arena results?
- [ ] Which agent CLIs support a `--model` flag or equivalent? (Claude Code `--model`, Gemini CLI `--model`, Cursor?) What are the valid model IDs for each?
- [ ] What should the configuration schema look like? Options include:
  - Per-agent per-task-type in `templates/agents/<id>.json` (e.g., `cli.models.research`, `cli.models.implement`)
  - User-level overrides in `~/.aigon/config.json`
  - Project-level overrides in `.aigon/config.json`
  - Environment variable approach (e.g., `AIGON_RESEARCH_MODEL`)
- [ ] Should model selection be automatic (Aigon picks the best model per task) or user-configurable (the user specifies models)? Or both with sensible defaults?
- [ ] What's the cost/performance trade-off? If research uses a cheaper model, does that meaningfully reduce costs for arena mode where multiple agents run in parallel?
- [ ] How should this interact with the existing arena mode? In an arena with `cc gg cx`, each already uses a different provider. Should model selection only apply within a single agent's different workflows?

## Scope

### In Scope
- Model flag support for Claude Code (`--model`), Gemini CLI, and Cursor (if applicable)
- Configuration schema design for per-task-type model selection
- Integration points in `buildAgentCommand()` and `buildResearchAgentCommand()`
- User overrides at global (`~/.aigon/config.json`) and project (`.aigon/config.json`) levels
- Sensible defaults (e.g., Opus for implementation, Sonnet for research if using Claude)

### Out of Scope
- Benchmarking or running actual comparative tests (that's a follow-up feature)
- Supporting model selection for non-CLI agents (API-based, programmatic)
- Model routing based on task complexity or content analysis (adaptive selection)
- Cost tracking or billing integration

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
