# Research: choose-recommend-model

## Context

Currently Aigon uses a fixed model per agent per task type (e.g., cc implement = Sonnet, gg implement = gemini-2.5-flash). Every feature gets the same model regardless of complexity — simple one-liner changes use the same expensive model as complex architectural refactors. This wastes cost on simple features and potentially under-powers complex ones.

The vision is a two-part system:
1. **Complexity assessment at feature creation time** — when a feature spec is written (by AI or human), frontmatter captures a complexity level that maps to a model tier.
2. **Model recommendation at feature-start time** — when starting a feature, Aigon suggests the appropriate model for each agent based on complexity, with the user able to override.

For example, with Claude Code: low complexity → Haiku, medium → Sonnet, high → Opus. Each agent has its own model ladder mapped to the same complexity scale.

## Questions to Answer

### Complexity assessment
- [ ] What factors determine feature complexity? (files touched, cross-cutting concerns, new vs modify, test requirements, domain knowledge needed)
- [ ] What complexity scale works best? (3 levels: low/medium/high? 5 levels? continuous score?)
- [ ] How should complexity be assessed during `feature-create`? (LLM analyzes the spec text? heuristic rules? both?)
- [ ] What frontmatter format should store complexity? (e.g., `complexity: medium`, `complexity_score: 3`)
- [ ] Can complexity be refined later? (e.g., after reading the codebase during `feature-do`, re-assess and switch models mid-flight?)
- [ ] How accurate is LLM-based complexity assessment? What are the failure modes? (over/under-estimation)
- [ ] Should the user be able to override the AI-assessed complexity?

### Model ladder per agent
- [ ] What models are available for each agent and how do they map to tiers?
  - CC: Haiku (low) → Sonnet (medium) → Opus (high)?
  - CX: gpt-4.1-mini (low) → gpt-4.1 (medium) → gpt-5.3-codex (high)?
  - GG: gemini-2.5-flash-lite (low) → gemini-2.5-flash (medium) → gemini-2.5-pro (high)?
- [ ] Should the model ladder be configurable per-repo or per-profile? (e.g., a company might mandate Sonnet minimum)
- [ ] How should the model ladder be stored? (agent config JSON? global config? both with override chain?)
- [ ] Does the model ladder need different mappings for implement vs evaluate vs research tasks?

### Resolution order
- [ ] What is the model resolution priority? (user override > complexity recommendation > repo config > global config > agent default)
- [ ] How should this interact with the existing `models.implement` / `models.research` / `models.evaluate` config?
- [ ] Should the dashboard show the recommended model and allow one-click override at feature-start time?

### Cost and quality tradeoffs
- [ ] What are typical cost ratios between tiers? (e.g., Haiku is 10x cheaper than Opus)
- [ ] How much quality difference is there between tiers for simple tasks? Is Haiku genuinely sufficient for low-complexity features?
- [ ] Could this be validated by running the same feature at different tiers and comparing eval scores?

## Scope

### In Scope
- Complexity assessment methods (LLM-based and heuristic)
- Model ladder definition per agent
- Frontmatter schema for complexity metadata
- Resolution order and override chain
- Integration points in `feature-create` and `feature-start`

### Out of Scope
- Automatic model switching mid-feature (beyond scope — research only)
- Cost tracking infrastructure (covered in observability research)
- Model fine-tuning or custom models
- Non-coding models (image generation, embeddings)

## Inspiration
- Current model config: `lib/config.js` lines 295-310 (`DEFAULT_GLOBAL_CONFIG.agents.*.models`)
- Agent templates: `templates/agents/cc.json`, `cx.json`, `gg.json`
- Feature spec format: `docs/specs/features/` (markdown with potential frontmatter)
- Model override chain: `lib/config.js` `getActiveProfile()` merge logic

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
