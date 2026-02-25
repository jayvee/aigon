# Research: Models for Research

## Context

Currently, Aigon has no model configuration. When an agent is launched (e.g., `claude --permission-mode acceptEdits "/aigon:feature-implement 55"`), it uses whatever model the user has configured globally for that CLI tool. The same model is used regardless of whether the agent is doing research exploration, feature implementation, code review, or feature evaluation.

Different task types have fundamentally different cognitive requirements:
- **Research exploration**: breadth of knowledge, creative association, summarisation, comparison
- **Feature implementation**: precise code generation, instruction following, tool use, attention to detail
- **Code review / feature-eval**: critical analysis, pattern recognition, conciseness — and crucially, independence from the model that wrote the code (to avoid self-evaluation bias)
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
- [ ] What model is most appropriate for `feature-eval` and `research-synthesize` (evaluation tasks)? Currently the user manually switches model (e.g., to Sonnet) to avoid Opus evaluating Opus. Should evaluation use a different model from the implementer, a different provider entirely, or a stronger model acting as judge?
- [ ] Is there an "evaluator bias" problem — does a model favour its own output style? What does the research say about LLM-as-judge when the judge is the same model that produced the work?
- [ ] Should the model switch be per task type across all three categories: research, implementation, and evaluation? What are the ideal model characteristics for each?

## Scope

### In Scope
- Model flag support for Claude Code (`--model`), Gemini CLI, and Cursor (if applicable)
- Configuration schema design for per-task-type model selection across three categories:
  - **Research**: models for `research-conduct` and `research-synthesize`
  - **Implementation**: models for `feature-implement` and `feature-review`
  - **Evaluation**: models for `feature-eval`, `research-synthesize` (judge role), and comparison tasks
- Integration points in `buildAgentCommand()` and `buildResearchAgentCommand()`
- User overrides at global (`~/.aigon/config.json`) and project (`.aigon/config.json`) levels
- Sensible defaults per task type (e.g., which model class suits research vs. implementation vs. evaluation)
- LLM-as-judge considerations: whether the evaluator should be a different model/provider from the implementer to avoid self-evaluation bias

### Out of Scope
- Benchmarking or running actual comparative tests (that's a follow-up feature)
- Supporting model selection for non-CLI agents (API-based, programmatic)
- Model routing based on task complexity or content analysis (adaptive selection)
- Cost tracking or billing integration

## Findings

See arena findings files:
- `logs/research-05-cc-findings.md` (Claude)
- `logs/research-05-cx-findings.md` (Codex)
- `logs/research-05-gg-findings.md` (Gemini)

### Key Consensus Points

All three agents agreed:
- `--model` flag injection follows the existing `implementFlag` pattern exactly — clean fit with Aigon's architecture
- Three task types: `research`, `implement`, `evaluate`
- Config schema: `cli.models.{research,implement,evaluate}` with `project > global > template` precedence
- LLM-as-judge self-evaluation bias is real (GPT-4: 87.76% self-preference; Claude: 25% win rate inflation) — cross-provider evaluation is the mitigation
- User-configurable defaults, not opaque auto-routing

### Key Divergence

**Cursor model flag**: cc reported no `--model` support; cx (primary source, ran `agent --help` live) and gg confirmed it does support `--model`. cx/gg finding is authoritative.

**Research model tier**: cc favours Opus-class for research depth; gg favours Flash-class for speed/cost in arena mode. Resolution: leave as user-configurable defaults — the plumbing is the same either way.

## Recommendation

Implement model selection in three phases:

1. **Feature 19 (core plumbing)**: Add `cli.models` schema, inject `--model` flag into command builders, set sensible template defaults per agent
2. **Feature 20 (eval bias)**: Warn on same-provider evaluation in solo mode; formalise cross-provider defaults in arena mode
3. **Feature 21 (tooling)**: Env var overrides, `aigon config models` CLI, `aigon doctor` model checks, docs

Keep defaults conservative and user-overridable. Do not auto-select models based on task complexity.

## Output

- [ ] Feature: [Feature 19 — Model Selection Core](../../features/02-backlog/feature-19-model-selection-core.md)
- [ ] Feature: [Feature 20 — Cross-Provider Eval](../../features/02-backlog/feature-20-cross-provider-eval.md)
- [ ] Feature: [Feature 21 — Model Management Tooling](../../features/02-backlog/feature-21-model-management-tooling.md)
