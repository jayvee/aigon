# Research Findings: models-for-research

**Agent:** Claude (cc)
**Research ID:** 05
**Date:** 2026-02-25

---

## Key Findings

### 1. CLI Model Flag Support

All major coding CLIs except Cursor support programmatic model selection at launch:

| Tool | Flag | Env Var | Programmatic? |
|------|------|---------|:---:|
| **Claude Code** | `--model <alias\|id>` | `ANTHROPIC_MODEL` | Yes |
| **Gemini CLI** | `-m` / `--model <id>` | `GEMINI_MODEL` | Yes |
| **Cursor** | None | None | No |
| **Copilot CLI** | None | `COPILOT_MODEL` | Env var only |
| **Aider** | `--model MODEL` | `AIDER_MODEL` | Yes |

**Claude Code** has the richest model config: aliases (`opus`, `sonnet`, `haiku`), full IDs (`claude-opus-4-6`), env vars (`ANTHROPIC_MODEL`), settings file (`{"model": "opus"}`), and subagent model control (`CLAUDE_CODE_SUBAGENT_MODEL`). Priority: in-session `/model` > `--model` flag > env var > settings file.

**Gemini CLI** supports `-m gemini-2.5-pro` at launch, with current models including gemini-3.1-pro-preview, gemini-2.5-pro, gemini-2.5-flash, and gemini-2.5-flash-lite.

**Cursor** is the gap: no `--model` flag exists on `cursor agent`. Model selection is UI-only or via in-session `/models`. This means Aigon cannot programmatically control Cursor's model.

**Implication for Aigon:** Model injection via `--model` flag works for cc and gg. For cu, model config would be silently ignored (or a warning emitted). Codex (cx) would need investigation.

### 2. Model Performance Differs Meaningfully by Task Type

Evidence from benchmarks and community experience confirms models have distinct strengths:

**Claude family:**
- **Opus**: Deep reasoning, code review, catching subtle bugs (async issues, missing disposes, rebuild problems). SWE-bench 80.9%.
- **Sonnet**: Daily coding, multi-file edits, balanced speed/quality. SWE-bench 77.2%. Near-Opus reasoning at fraction of cost.
- **Haiku**: Quick fixes, UI scaffolding, autocomplete. SWE-bench 73.3%. Best cost-effectiveness.

**Cross-provider:**
- Gemini 2.5 Pro excels at algorithmic reasoning (thinking model architecture)
- GPT-4o is fastest for simple tasks; o3 adds deep reasoning but overthinks simple queries
- Community pattern: "Haiku for setup, Sonnet for builds, Opus for reviews"

**For Aigon's three task categories:**

| Task Category | Ideal Model Characteristics | Recommended Tier |
|--------------|----------------------------|-----------------|
| **Research** (research-conduct) | Breadth of knowledge, creative association, thorough exploration | Opus-class (highest reasoning) |
| **Implementation** (feature-implement, feature-review) | Precise code generation, instruction following, tool use | Sonnet-class (balance of speed + capability) |
| **Evaluation** (feature-eval, research-synthesize) | Critical analysis, independence from implementer | **Different provider/family** from implementer |

### 3. LLM-as-Judge Self-Evaluation Bias is Real and Measurable

This is the most critical finding for Aigon's evaluation workflow.

**The problem:**
- GPT-4 preferred its own outputs **87.76%** of the time vs humans preferring them only **47.61%**
- Claude-v1 showed a **25% higher win rate** when judging its own outputs (MT-Bench study)
- The bias operates through **perplexity** (text familiarity), not self-recognition — a model rates text written in its own style higher even without knowing it produced it
- **Family bias** extends beyond self-preference: GPT-4o rates other GPT outputs higher; Claude rates other Claude outputs higher

**Key implication:** Using Sonnet to evaluate Opus code (same family) is better than Opus evaluating Opus, but **still biased**. Cross-family evaluation (e.g., Gemini judging Claude code) is significantly more objective.

**Research-backed mitigations:**
1. Cross-family judging (strongest effect: 5-7% bias reduction)
2. Position randomization (swap candidate order, average scores)
3. Explicit rubrics with scoring criteria
4. Chain-of-thought before scoring (reasoning first, then score)
5. Ensemble judging with 3+ model families for critical decisions

**For Aigon specifically:** The current manual pattern of "switch to Sonnet for eval" reduces but doesn't eliminate bias. The ideal is cross-provider evaluation — if cc (Claude) implements, use gg (Gemini) or even a dedicated GPT-based judge for eval.

### 4. Architecture Analysis — Clean Injection Points Exist

Aigon's architecture is well-suited for model selection. The existing `implementFlag` pattern provides a proven template:

**Current command building (line 984):**
```
claude --permission-mode acceptEdits "/aigon:feature-implement 55"
```

**With model injection:**
```
claude --permission-mode acceptEdits --model sonnet "/aigon:feature-implement 55"
```

**Key functions to extend:**
- `getAgentCliConfig()` (line 905) — already does 3-level merge (template → global → project). Add `models` field.
- `buildAgentCommand()` (line 984) — inject `--model` flag. Needs a `taskType` parameter.
- `buildResearchAgentCommand()` (line 1001) — inject `--model` flag with `research` task type.
- New: `buildEvalAgentCommand()` or pass task type to existing builders.

**Precedent:** Feature-08 (agent CLI flag overrides) already demonstrated this exact pattern for `implementFlag`. Model selection follows identically.

### 5. Configuration Schema Design

**Proposed schema — `cli.models` at three levels:**

**Agent template default** (`templates/agents/cc.json`):
```json
{
  "cli": {
    "command": "claude",
    "implementFlag": "--permission-mode acceptEdits",
    "models": {
      "research": "opus",
      "implement": "sonnet",
      "evaluate": "sonnet"
    }
  }
}
```

**Global override** (`~/.aigon/config.json`):
```json
{
  "agents": {
    "cc": {
      "models": {
        "research": "claude-opus-4-6",
        "implement": "claude-sonnet-4-6",
        "evaluate": "claude-sonnet-4-6"
      }
    }
  }
}
```

**Project override** (`.aigon/config.json`) — same structure, highest priority.

**Merge strategy:** Same as existing config — project > global > template defaults. Each `models` key is independently overridable.

### 6. Arena Mode Interaction

In arena mode with `cc gg cx`, each agent already uses a different provider. Model selection applies **within** each agent's workflows:

- `cc` might use Opus for research but Sonnet for implementation
- `gg` might use gemini-2.5-pro for research but gemini-2.5-flash for implementation
- Each agent's config is independent

For **evaluation**, arena mode already provides natural cross-provider judging: Claude evaluating Gemini's code (and vice versa) avoids self-evaluation bias. The recommendation is to formalize this — `feature-eval` should prefer a different agent/provider from the implementer.

### 7. Cost/Performance Analysis

Model selection can meaningfully reduce arena costs:

| Task | Model | Input Cost (per M tokens) |
|------|-------|--------------------------|
| Research | Opus | $15 |
| Implementation | Sonnet | $3 |
| Evaluation | Sonnet | $3 |

If research uses Opus (~20% of total tokens) and implementation uses Sonnet (~70% of total tokens), vs using Opus for everything, the cost reduction is approximately **60-70%** with minimal quality loss on implementation tasks (Sonnet scores within 4% of Opus on SWE-bench).

For arena mode with 3 agents running in parallel, the savings multiply.

## Sources

### CLI Documentation
- [Claude Code CLI docs](https://code.claude.com/docs/en/model-config) — `--model` flag, aliases, env vars
- [Gemini CLI model docs](https://geminicli.com/docs/cli/model/) — `-m` flag, model IDs
- [Cursor CLI docs](https://cursor.com/docs/cli/using) — no `--model` flag confirmed
- [Aider options reference](https://aider.chat/docs/config/options.html) — `--model` flag with LiteLLM

### LLM-as-Judge Research
- [Wataoka et al. (2024) "Self-Preference Bias in LLM-as-a-Judge"](https://arxiv.org/abs/2410.21819) — perplexity mechanism, 87.76% self-preference rate for GPT-4
- [Zheng et al. (2023) "Judging LLM-as-a-Judge with MT-Bench"](https://arxiv.org/abs/2306.05685) — 25% win rate inflation for Claude, 10% for GPT-4
- [Ye et al. (2024) "Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge" (ICLR 2025)](https://arxiv.org/abs/2410.02736) — 12 bias taxonomy, CALM framework
- [Sigl (2024) "The 5 Biases That Can Silently Kill Your LLM Evaluations"](https://www.sebastiansigl.com/blog/llm-judge-biases-and-how-to-fix-them/) — practical recommendations

### Model Benchmarks & Comparisons
- [SWE-bench Verified results](https://www.swebench.com/) — Claude Opus 80.9%, Sonnet 77.2%
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — Opus/Sonnet/Haiku capabilities
- [Stanford HAI 2025 AI Index Report](https://hai.stanford.edu/ai-index/2025-ai-index-report/technical-performance) — convergence trends

### Aigon Architecture
- Feature-08 spec (agent CLI flag overrides) — precedent for config hierarchy pattern

## Recommendation

### Three-tier model selection with cross-provider evaluation

**1. Add `cli.models` to agent config** with three task types: `research`, `implement`, `evaluate`. Follow the existing `implementFlag` pattern — defaults in template, overridable at global and project levels.

**2. Sensible defaults per agent:**
- **cc (Claude):** research=opus, implement=sonnet, evaluate=sonnet
- **gg (Gemini):** research=gemini-2.5-pro, implement=gemini-2.5-pro, evaluate=gemini-2.5-flash
- **cx (Codex):** research=default, implement=default, evaluate=default (investigate flag support)
- **cu (Cursor):** no model flag support — skip or warn

**3. Cross-provider evaluation:** For `feature-eval`, automatically prefer a different agent than the implementer. If cc implemented, suggest gg or cx for eval. If arena mode, this is already natural — formalize it.

**4. Implementation approach:**
- Phase 1: Add `cli.models` config schema + `--model` flag injection in `buildAgentCommand()` and `buildResearchAgentCommand()` (the core plumbing)
- Phase 2: Add `buildEvalCommand()` with cross-provider selection logic
- Phase 3: Add `aigon config models` CLI for easy model management

**5. Don't over-automate:** Let users choose models via config. Don't auto-detect "best" model per task — that's out of scope and error-prone. Provide sensible defaults they can override.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|---|---|---|---|
| `model-config-schema` | Add `cli.models` field to agent config with research/implement/evaluate task types, supporting template/global/project override hierarchy | high | none |
| `model-flag-injection` | Inject `--model` flag into `buildAgentCommand()` and `buildResearchAgentCommand()` based on task type | high | `model-config-schema` |
| `cross-provider-eval` | For feature-eval, prefer a different agent/provider than the implementer to reduce self-evaluation bias | medium | `model-flag-injection` |
| `model-config-cli` | Add `aigon config models` subcommand to view/set model configuration per agent per task type | low | `model-config-schema` |
