# Research Findings: models-for-research

**Agent:** Codex (cx)
**Research ID:** 05
**Date:** 2026-02-25

---

## Key Findings

1. Aigon already has clean technical injection points for per-task model selection.
- `buildAgentCommand()` and `buildResearchAgentCommand()` are the two launch paths today ([`aigon-cli.js:984`](../../../../aigon-cli.js), [`aigon-cli.js:1001`](../../../../aigon-cli.js)).
- `getAgentCliConfig()` already merges agent CLI config with project/global overrides ([`aigon-cli.js:905`](../../../../aigon-cli.js)).
- Current model behavior is implicit (whatever model the user has globally configured in each CLI); Aigon passes no `--model`.

2. All active Aigon CLIs support explicit model selection (or equivalent).
- **Claude Code (`cc`)**: `--model <model>` supports aliases (for example `sonnet`, `opus`) and full model names (for example `claude-sonnet-4-6`).
- **Gemini CLI (`gg`)**: `-m/--model` is parsed by CLI; precedence is `argv.model` -> `GEMINI_MODEL` env -> settings model name.
- **Codex CLI (`cx`)**: `-m/--model <MODEL>` is supported; model can also be overridden with `-c model="..."`.
- **Cursor Agent (`cu`)**: `--model <model>` plus discovery via `--list-models` or `agent models`.

3. Valid model IDs are provider-specific and should be treated as data, not hardcoded constants.
- **Claude IDs** come from Anthropic model names (examples: `claude-opus-4-1`, `claude-sonnet-4-5`, `claude-haiku-4-5`).
- **Gemini IDs** come from Gemini model catalog (examples: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`).
- **Cursor IDs** are account/provider-dependent; local `agent models` currently returns IDs such as `gpt-5.3-codex-high`, `opus-4.6-thinking`, `gemini-3.1-pro`.
- **Codex IDs** are provider-dependent; CLI accepts model string but does not provide a built-in model list command in help output.

4. Evidence supports task-specific model choices rather than one-model-for-all.
- **Aigon arena evidence (local):** 4 arena evals in `docs/specs/features/evaluations/`; winners were `cx` in 3 and `cu` in 1 (`feature-06`, `13`, `15`, `16`). This is small-N but demonstrates practical variance by agent/model stack.
- **Public coding-agent benchmarks:** Terminal-Bench and Live-SWE-agent leaderboards show significant spread between model variants on terminal/code tasks.
- **Provider guidance:** Anthropic and Google explicitly segment models by capability/speed/cost tiers (Opus vs Sonnet/Haiku, Pro vs Flash/Flash-Lite), which aligns with per-task routing.

5. Evaluator bias is a real risk in LLM-as-judge workflows.
- MT-Bench work found LLM judges useful but not free from bias effects.
- Newer work (for example Self-Preference Bias and Strategic Bias papers) shows judges can systematically favor outputs with style/similarity advantages and can be manipulated.
- For `feature-eval` and `research-synthesize`, evaluator model should default to a different model family (ideally different provider) than the implementer/researcher.

6. Cost/performance impact in arena mode is material and linear with number of agents.
- Arena cost scales approximately with `num_agents * tokens * per-token-rate`.
- Pricing tiers differ by large factors (for example Anthropic Opus vs Sonnet, Gemini Pro vs Flash), so using cheaper-but-capable research models can reduce total arena spend substantially without changing architecture.

7. Recommended config design: user-configurable with sensible defaults, not fully automatic opaque routing.
- Automatic defaults by task type should exist.
- Users should be able to override globally (`~/.aigon/config.json`), per-project (`.aigon/config.json`), and via env vars for one-off runs.
- This preserves predictability and debuggability in multi-agent workflows.

8. Proposed schema (backward-compatible) for per-task model selection:

```json
{
  "agents": {
    "cc": {
      "cli": "claude",
      "implementFlag": "--permission-mode acceptEdits",
      "models": {
        "research": "sonnet",
        "implement": "opus",
        "evaluate": "sonnet"
      },
      "modelFlag": "--model"
    }
  },
  "models": {
    "defaults": {
      "research": null,
      "implement": null,
      "evaluate": null
    }
  }
}
```

Suggested precedence:
`env override (task+agent) > project config > global config > agent task default > existing CLI default`.

9. Arena interaction recommendation:
- Keep model selection **within each agent workflow** (research/implement/evaluate) rather than trying to auto-balance across agents in this feature.
- Add an evaluator-safety rule: warn (or require `--allow-same-model-judge`) if evaluator model equals implementer model on solo flows.

## Sources

- Aigon command injection points and config merge:
  - `aigon-cli.js` (`getAgentCliConfig`, `buildAgentCommand`, `buildResearchAgentCommand`)
- Local CLI capability checks:
  - `claude --help` (`--model`, alias/full-name examples)
  - `codex --help` (`-m/--model`)
  - `agent --help` (`--model`, `--list-models`, `models`)
  - `agent models` (live account model IDs)
  - Gemini local parser (`/opt/homebrew/lib/node_modules/@google/gemini-cli/dist/src/config/config.js`)
- Anthropic Claude Code model config:
  - https://docs.anthropic.com/en/docs/claude-code/settings#model-configuration
- Anthropic model IDs / model tiers:
  - https://docs.anthropic.com/en/docs/about-claude/models/overview
- Gemini CLI command-line args and model env var:
  - https://geminicli.com/docs/cli/configuration/
- Gemini model catalog / IDs:
  - https://ai.google.dev/gemini-api/docs/models
- Cursor CLI model support and listing:
  - https://cursor.com/changelog/1-6
  - https://docs.cursor.com/en/agent/terminal
- Pricing (cost trade-off inputs):
  - https://www.anthropic.com/pricing
  - https://ai.google.dev/pricing
- Benchmark signals:
  - https://www.tbench.ai/
  - https://live-swe-agent.com/
- LLM-as-judge bias and reliability:
  - https://arxiv.org/abs/2306.05685
  - https://arxiv.org/abs/2410.21819
  - https://arxiv.org/abs/2406.07791

## Recommendation

Implement **explicit per-task model selection** as a first-class config feature with predictable override precedence.

Recommended policy:
1. Add `agents.<id>.models.{research,implement,evaluate}` and optional `agents.<id>.modelFlag` to config schema.
2. Extend command builders to inject model for:
   - `research-conduct` -> task=`research`
   - `feature-implement` / `feature-review` -> task=`implement`
   - `feature-eval` / `research-synthesize` guidance + launch helpers -> task=`evaluate`
3. Add global/project/env overrides with clear precedence and `aigon config get` provenance.
4. Add evaluator guardrail: default evaluator should differ from implementer model family/provider where possible.
5. Keep defaults conservative:
   - Research: balanced reasoning + cost.
   - Implement: strongest coding-capable model available to that agent.
   - Evaluate: high-judgment model, preferably provider-different from implementation model.

This gives immediate control and reproducibility without requiring adaptive routing complexity.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|---|---|---|---|
| task-type-model-schema | Add config schema for `agents.<id>.models.{research,implement,evaluate}` + optional `modelFlag`, with migration-safe defaults. | high | none |
| model-aware-command-builders | Update command builders to inject task-appropriate model flag for research/implement flows, preserving current behavior when unset. | high | task-type-model-schema |
| model-override-precedence | Add global/project/env precedence resolution and provenance display for resolved task model settings. | high | task-type-model-schema |
| evaluator-bias-guardrails | Add warnings/guards when evaluator model matches implementer model, with explicit override flag. | medium | model-aware-command-builders |
| model-validation-doctor | Add `aigon doctor models` checks for invalid/missing model IDs and provider-specific flag compatibility. | medium | model-override-precedence |
| docs-model-selection-workflow | Document model strategy for research/implement/evaluate and arena usage patterns in README + workflow docs. | medium | model-aware-command-builders |
