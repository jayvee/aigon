# Research: new-models

## Context

Aigon currently supports agents backed by specific LLM providers — Claude Code (Anthropic), Gemini CLI (Google), Codex (OpenAI), and Cursor (multi-model IDE). The open-source and alternative model landscape is evolving rapidly, with models like Kimi 2.5 and MiniMax M2.5 emerging as credible coding agents.

Expanding model support would give Aigon users more options for arena mode (more diverse competitors), reduce dependency on a small set of providers, and potentially offer cost advantages. However, new models need a viable CLI or agent interface to be useful — Aigon orchestrates agents, not raw API calls.

The key question is not just "which models are good" but "which models have agent tooling that Aigon can orchestrate" — i.e., a CLI, terminal-based agent, or API-driven agent runner that supports file editing, command execution, and project-level context.

## Questions to Answer

### Model Landscape
- [ ] What open-source and alternative models are currently competitive for coding tasks (benchmarks, community consensus)?
- [ ] Which of these models have a CLI agent or terminal-based coding tool available?
- [ ] What are the standout capabilities of Kimi 2.5 and MiniMax M2.5 specifically?
- [ ] Are there other notable models to consider (e.g., DeepSeek, Qwen, Mistral, Llama, Yi, Command R+)?

### Agent Tooling
- [ ] What CLI/terminal agents exist for running open-source models (e.g., Aider, Continue, Open Interpreter, local Cline)?
- [ ] Can any of these agents be configured to use alternative model backends?
- [ ] Do any models ship their own first-party coding agent (like Gemini CLI or Codex)?
- [ ] What is the state of Ollama / vLLM / other local inference for coding agents?

### Aigon Integration Feasibility
- [ ] What would an Aigon agent config (`templates/agents/<id>.json`) look like for a new model?
- [ ] Does the new model/agent support the file operations Aigon requires (read, write, execute, git)?
- [ ] Can the agent accept project-level instructions (equivalent to AGENTS.md, slash commands)?
- [ ] What command format does each agent use for non-interactive/headless execution?

### Strategic Considerations
- [ ] Does adding more agents improve arena mode outcomes (more diverse approaches)?
- [ ] What is the cost profile — free/open-source vs API-priced vs subscription?
- [ ] Are there quality thresholds below which adding an agent is counterproductive (noisy arena results)?
- [ ] Should Aigon distinguish between "first-class" and "community" agent support tiers?

## Scope

### In Scope
- Survey of open-source and alternative models with coding capabilities
- Assessment of CLI/agent tooling available for each model
- Feasibility of Aigon integration for top candidates
- Kimi 2.5 and MiniMax M2.5 as named candidates
- Cost and quality trade-off analysis

### Out of Scope
- Implementing new agent support in Aigon
- Building custom agent wrappers or CLI tools for models
- Fine-tuning or training models
- Non-coding use cases (chat, image generation, etc.)

## Inspiration
- Kimi 2.5 (Moonshot AI)
- MiniMax M2.5
- Existing Aigon agents: cc (Claude Code), gg (Gemini CLI), cx (Codex), cu (Cursor)
