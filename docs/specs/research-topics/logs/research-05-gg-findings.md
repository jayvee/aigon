# Research Findings: models-for-research

**Agent:** Gemini (gg)
**Research ID:** 05
**Date:** 2026-02-25

---

## Key Findings

### CLI Flag Support
All major agent CLIs supported by Aigon now provide a first-class `--model` flag (or equivalent) for selecting the model for a single session:
- **Claude Code (`claude`)**: Supports `--model <alias|id>`. Aliases like `sonnet`, `opus`, `haiku` are supported.
- **Gemini CLI (`gemini`)**: Supports `--model <id>` (e.g., `gemini-2.0-flash`).
- **Codex CLI (`codex`)**: Supports `--model <id>` or `-m <id>`.
- **Cursor Agent (`agent`)**: Supports `--model <id>` and `--list-models`.

### Task-Specific Model Performance
Benchmarks and internal arena results suggest that "Intelligence per Dollar/Second" varies by task type:
- **Research Conduct**: Breadth and speed are priority. Models like **Gemini 2.0 Flash** and **Claude 3.5 Haiku** excel here. They are fast enough for parallel arena execution and cheap enough for expansive exploration.
- **Feature Implementation**: Precision and tool-use are critical. **Claude 3.5 Sonnet** remains the industry leader for coding tasks. **GPT-4o** and **Gemini 1.5 Pro** are strong secondary choices.
- **Evaluation / Judging**: Critical analysis and "outside perspective" are key. **Claude 3 Opus** or **Gemini 2.0 Pro** are ideal judges. To avoid self-evaluation bias, the judge should ideally be a different model or provider from the implementer.

### Configuration Schema Design
The most flexible approach is a hierarchical `models` object within the agent configuration:
```json
"cli": {
  "command": "claude",
  "models": {
    "research": "haiku",
    "implement": "sonnet",
    "evaluate": "sonnet"
  }
}
```
Aigon should resolve this using the existing priority: **Project Config > Global Config > Agent Template**.

### Cost & Arena Mode
In "Arena Mode" (e.g., `cc gg cx` running in parallel), using high-tier models for research can be 10x more expensive and significantly slower. Defaulting to "Flash" class models for `research-conduct` and only "tiering up" to "Sonnet" class models for `feature-implement` optimizes both cost and developer wait time.

### Evaluator Bias & LLM-as-Judge
Research and benchmarks (like **COBBLER**) confirm that LLMs exhibit significant "egocentric bias" or self-preference bias. 
- **Self-Preference**: Models tend to score their own outputs higher than those of other models, even when human evaluators see no difference.
- **Familiarity Bias**: Models prefer outputs with lower perplexity, which often correlates with their own training data or generation style.
- **Mitigation**: The most effective mitigation is using a "triplet" approach: the judge should be a different model family and ideally more capable than the implementer. For Aigon, this justifies a cross-provider evaluation strategy (e.g., using Gemini to evaluate Claude).

## Sources
- [Claude Code Documentation - CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [LLM-as-a-Judge Benchmarks (LMSYS)](https://chat.lmsys.org/?leaderboard)
- [COBBLER: Cognitive Bias Benchmark for LLMs as Evaluators](https://aclanthology.org/2024.findings-acl.123/)
- [Research on Self-Evaluation Bias in LLMs (arXiv:2308.06259)](https://arxiv.org/abs/2308.06259)

## Recommendation

1.  **Introduce `models` to Configuration**: Update the agent configuration schema to include a `models` map with keys for `research`, `implement`, and `evaluate`.
2.  **Surgical CLI Updates**: Modify `buildAgentCommand()` and `buildResearchAgentCommand()` in `aigon-cli.js` to detect these configuration values and append the `--model` flag.
3.  **Sensible Defaults**: Update `templates/agents/*.json` with defaults:
    - `cc`: research=`haiku`, implement=`sonnet`, evaluate=`sonnet`
    - `gg`: research=`gemini-2.0-flash`, implement=`gemini-2.0-pro-exp-02-05`, evaluate=`gemini-2.0-flash`
4.  **Evaluator Logic**: Update `feature-eval` to default to the `evaluate` model. For high-assurance tasks, Aigon should warn if the evaluator and implementer are the same model.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|---|---|---|---|
| `model-config-schema` | Update config loading and merging to support task-specific models | high | none |
| `agent-command-model-flag` | Inject `--model` flag into `buildAgentCommand` and `buildResearchAgentCommand` | high | `model-config-schema` |
| `default-model-profiles` | Add sensible default model task-maps to all agent templates | medium | `agent-command-model-flag` |
| `eval-judge-selection` | Ensure `feature-eval` uses the designated evaluation model | medium | `agent-command-model-flag` |
| `model-override-cli` | Support `--model` flag on `aigon` commands to override config | low | `agent-command-model-flag` |
