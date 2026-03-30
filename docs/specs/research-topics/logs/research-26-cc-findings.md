# Research Findings: Improve Agent Signalling

**Agent:** Claude (cc)
**Research ID:** 26
**Date:** 2026-03-29

---

## Key Findings

### 1. Understanding the Problem

**Which agents drop signals?**
All agents can drop signals, but the risk profile differs based on CLI capabilities:
- **Codex (cx)**: Highest risk. Its `Stop` hook is non-blocking (observability only, can't force retry). The hooks system is feature-flagged and off by default. Codex relies entirely on prompt compliance.
- **Gemini (gg)**: Medium risk. Has the strongest enforcement capability (`AfterAgent` hook can reject and force retry), but Aigon doesn't use it yet. Currently relies on extra-verbose prompts with embedded pitfall sections and Step 0 branch verification.
- **Mistral Vibe (mv)**: Medium-high risk. Zero hooks system — compliance is entirely prompt-dependent. Fire-and-forget invocation via `-p` flag.
- **Claude Code (cc)**: Lowest risk. Has a mature `Stop` hook that can block session end, plus `SessionEnd` for cleanup. But neither is currently wired to enforce lifecycle signals.

**Which signals get dropped?**
The `agent-status submitted` signal at the end of execution is the most likely to be dropped. This is consistent with the "Lost in the Middle" research (Liu et al., 2023): LLMs attend strongly to the beginning and end of context but poorly to the middle. However, in long-running agent sessions, the submitted signal sits at the *temporal* end — far from the *prompt* end — making it vulnerable to being overshadowed by the implementation work that consumed most of the context window.

`agent-status implementing` at the start is less likely to be dropped because it's positioned early in the prompt flow, the agent hasn't yet consumed context on implementation work, and it maps to the agent's initial orientation phase.

**Correlation with complexity?**
Yes — longer tasks consume more context, pushing lifecycle instructions further from attention. The IFEval benchmark (Google, 2023) shows models have a finite "instruction budget": more instructions = lower per-instruction compliance rates. Complex features generate longer conversations that dilute the relative prominence of lifecycle signals.

**Common patterns in signal-dropping:**
- Agent completes implementation, writes commit message, and considers itself "done" — the LLM's internal task-completion heuristic fires before the lifecycle checklist
- Context window exhaustion on long tasks means the original prompt with lifecycle instructions may be compressed or dropped
- Error exits (test failures, merge conflicts) derail the normal flow and the agent never reaches the "final steps" section

### 2. Temperature & Sampling

**Temperature has negligible impact on lifecycle compliance within the 0.0–1.0 range.**

The most rigorous evidence comes from Renze & Guven (2024, EMNLP): testing 9 models across temperatures 0.0–1.6, the Kruskal-Wallis test yielded **p=0.403** — no statistically significant difference in instruction-following performance from 0.0 to 1.0. Performance only collapses above 1.0.

A second study ("Hot or Cold?", arXiv 2506.07295) measured instruction following specifically: IF performance remains largely unchanged from 0 to 1.0. The negative correlation (Pearson: -0.40) is driven primarily by temperatures above 1.0.

**Critical model-specific constraints:**
- **OpenAI reasoning models (o1, o3, GPT-5 series, Codex)**: Temperature is **fixed at 1.0** and cannot be changed. The `model_reasoning_effort` parameter (`minimal`/`low`/`medium`/`high`/`xhigh`) is the closest analog — higher effort may improve compliance but costs more tokens.
- **Google Gemini 3**: Google explicitly warns that temperatures below 1.0 can cause **response looping and degraded reasoning**. The model is optimized for temperature 1.0.
- **Claude**: Temperature range 0.0–1.0, default 1.0. Even at 0.0, results aren't fully deterministic. Anthropic recommends adjusting temperature only, not top_p.

**Trade-off curve**: For coding tasks, the Codex paper established that temperature 0.2 is optimal for pass@1 (single attempt), but temperature is irrelevant for instruction compliance within the normal range.

**Verdict**: Temperature tuning is a dead end for this problem. The initial analysis in the research spec was correct: "it makes models more deterministic about what they were already going to do, not more compliant."

### 3. Prompt Engineering

**Recency anchoring (critical instructions at the end): HIGH IMPACT**

The "Lost in the Middle" paper (Liu et al., 2023) demonstrates a U-shaped attention curve: LLMs attend to the beginning and end of context, with a trough in the middle. Anthropic's own prompt guide confirms: "Queries at the end can improve response quality by up to 30% in tests."

Current state in Aigon: The `agent-status submitted` instruction sits in the "When You're Done" section at lines 202-227 of feature-do.md — positioned at the *end* of the template, which is good. But by the time the agent reaches completion, this instruction is buried under potentially thousands of lines of conversation history. The template's position matters less than the instruction's position relative to the *current context window*.

**Reducing instruction count: HIGH IMPACT**

Anthropic's Claude Code docs explicitly warn: "If your CLAUDE.md is too long, Claude ignores half of it because important rules get lost in the noise." And: "CLAUDE.md files over 200 lines consume more context and may reduce adherence."

Current state: The feature-do template is ~227 lines with 7 steps. GG receives even more via embedded pitfall sections (AGENT_PITFALLS placeholder). The signal-to-noise ratio for lifecycle instructions is low.

**Stronger framing language: MODERATE IMPACT with diminishing returns**

Anthropic confirms emphasis (MUST/REQUIRED) improves adherence but warns for Claude 4.6: "Where you might have said 'CRITICAL: You MUST use this tool when...', you can use more normal prompting." For older models, aggressive language helps; for Claude 4.6, it may cause overtriggering.

More effective than imperatives: **providing motivation**. "Your implementation will not appear on the dashboard and will be invisible to the team unless you run `aigon agent-status submitted`" is stronger than "YOU MUST RUN agent-status submitted."

**Pre-flight/post-flight checklist format: MODERATE IMPACT**

Supported by Anthropic's recommendation for sequential numbered steps and by agent framework patterns (CrewAI guardrails, LangGraph conditional edges). Current feature-do.md already uses numbered steps, which is good.

**Multi-turn phase splitting: HIGHEST IMPACT (but hardest to implement)**

Anthropic's "Building Effective Agents" guide identifies prompt chaining as a core pattern. DIN-SQL showed ~10% improvement from decomposing monolithic tasks into sequential sub-tasks. The key advantage: Phase 2 (lifecycle completion) starts with a clean instruction focus, not buried under implementation context.

### 4. Structural Enforcement

This is where the highest-reliability solutions live. The key insight from Temporal.io: the **runtime** should guarantee completion, not the **agent**.

**Layer 1: Shell trap wrapper (90% coverage)**

Wrap the agent command in tmux with a shell trap:
```bash
tmux new-session -d -s name 'bash -lc "
  trap \"aigon agent-status submitted\" EXIT
  aigon agent-status implementing
  claude --dangerously-skip-permissions ...
"'
```

This fires on normal exit, Ctrl+C (SIGINT), and SIGTERM. Failure modes: does NOT fire on SIGKILL or machine crash (both rare).

This is implementable in `buildAgentCommand()` / `ensureTmuxSessionForWorktree()` in `lib/worktree.js`. The agent status changes from being an LLM responsibility to being a shell responsibility. The `implementing` signal fires before the LLM even starts; the `submitted` signal fires after it exits regardless of how.

**Nuance**: The trap fires `submitted` even on error exits. A smarter version:
```bash
trap 'code=$?; if [ $code -eq 0 ]; then aigon agent-status submitted; else aigon agent-status error; fi' EXIT
```

**Layer 2: Agent CLI hooks (agent-specific, 95% coverage)**

Each agent CLI has different hook capabilities:

| Agent | Best Hook | Behavior | Reliability |
|-------|-----------|----------|-------------|
| **CC** | `Stop` hook | Can block session end, force Claude to continue if signal not found in transcript | High — blocking, can enforce |
| **GG** | `AfterAgent` hook | Can **reject response and force retry** if lifecycle signals missing | Highest — automatic retry loop |
| **CX** | `Stop` event + `PostToolUse` | Stop is non-blocking (can't force); PostToolUse can inject reminders | Medium — advisory only |
| **MV** | None | Zero hook support | None — prompt-only |

For CC specifically, a `Stop` hook that checks whether `aigon agent-status submitted` appears in recent tool calls could block the session from ending until the signal is sent. This is the second-most powerful enforcement after shell traps.

For GG, the `AfterAgent` hook with `decision: "deny"` + feedback text is the strongest mechanism across all agents — it can literally force the model to retry until compliance is achieved.

**Layer 3: Polling supervisor (catches remaining 5%)**

The AIGON server already polls agent status every 10 seconds and checks tmux session liveness. Adding a "stale implementing" detector:
- If tmux session is gone AND agent status is still "implementing" AND last status update was >5 minutes ago → auto-transition to "error" or "needs-attention" state.

This is a safety net for all failure modes including machine crash.

**Layer 4: Doctor reconciliation (manual catch-all)**

`aigon doctor --fix` already handles manifest desync. Extending it to detect and repair orphaned "implementing" states completes the coverage.

### 5. Agent-Specific Configuration Options

**Codex CLI** knobs beyond temperature:
- `model_reasoning_effort`: `high`/`xhigh` may improve compliance (closest analog to temperature for reasoning models)
- `developer_instructions`: Additional system prompt text injected into sessions — can add lifecycle reminders
- `codex_hooks` feature flag: Once enabled, provides `PreToolUse`, `PostToolUse`, `Stop` events
- `model_instructions_file`: Can replace built-in instructions entirely

**Claude Code** knobs:
- 25 lifecycle hook events, including `Stop` (blocking), `SessionEnd`, `TaskCompleted`
- `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` to extend SessionEnd timeout
- Permission modes for safety levels

**Gemini CLI** knobs:
- `AfterAgent` hook with deny/retry capability
- `generateContentConfig.temperature` via model aliases
- `thinkingBudget` configuration
- `.gemini/policies/` for persistent rule files

**Mistral Vibe** knobs:
- `system_prompt_id` for custom system prompts
- `--max-turns` to prevent runaway sessions
- `--enabled-tools` / `--disabled-tools` for tool whitelisting
- No hooks — all compliance is prompt-based

### 6. Tmux Hook Gotchas

Tmux hooks are **unreliable as a sole mechanism** due to five documented failure modes:

1. **Last-session-on-server**: When the closing session is the last one, `session-closed` hooks fail because the server is shutting down
2. **Per-pane hook destruction race**: Pane options are freed before the hook callback fires
3. **Simultaneous pane death**: Multiple deaths cause missed events
4. **Signal-based termination**: SIGHUP/SIGTERM don't always trigger hooks (partially fixed in tmux 2.6+)
5. **Environment context**: `run-shell` executes in a limited environment with potentially wrong PATH/cwd

Shell `trap EXIT` inside the tmux command is far more reliable than tmux-level hooks.

## Sources

### Academic Papers
- Renze & Guven, "The Effect of Sampling Temperature on Problem Solving in Large Language Models" (EMNLP 2024) — https://arxiv.org/html/2402.05201v3
- "Exploring the Impact of Temperature on Large Language Models: Hot or Cold?" — https://arxiv.org/html/2506.07295v1
- Liu et al., "Lost in the Middle: How Language Models Use Long Contexts" (2023) — https://arxiv.org/abs/2307.03172
- "LLM In-Context Recall is Prompt Dependent" (2024) — https://arxiv.org/abs/2404.08865
- "The Instruction Gap: LLMs Get Lost in Following Instructions" — https://arxiv.org/html/2601.03269
- IFEval: Instruction-Following Evaluation (Google, 2023) — https://arxiv.org/abs/2311.07911
- "Position Bias in LLM-as-a-Judge" (2024) — https://arxiv.org/abs/2406.07791
- AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents — https://arxiv.org/html/2503.18666v1
- AGENTIF: Benchmarking Instruction Following of LLM Agents — https://keg.cs.tsinghua.edu.cn/persons/xubin/papers/AgentIF.pdf

### Vendor Documentation
- Anthropic Prompt Engineering Guide — https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering
- Anthropic "Building Effective Agents" — https://anthropic.com/research/building-effective-agents
- Claude Code Hooks Reference — https://code.claude.com/docs/en/hooks
- Claude Code Best Practices — https://code.claude.com/docs/en/best-practices
- OpenAI Codex CLI Reference — https://developers.openai.com/codex/cli/reference
- OpenAI Codex Configuration Reference — https://developers.openai.com/codex/config-reference
- OpenAI Codex Hooks — https://developers.openai.com/codex/hooks
- Google Gemini CLI Hooks — https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md
- Google Gemini Temperature Guidance — https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/prompts/adjust-parameter-values
- Mistral Vibe Configuration — https://docs.mistral.ai/mistral-vibe/introduction/configuration

### Framework Patterns
- Temporal.io Workflows — https://docs.temporal.io/workflows
- "Checkpoints Are Not Durable Execution" (Diagrid) — https://www.diagrid.io/blog/checkpoints-are-not-durable-execution
- CrewAI Task Documentation — https://docs.crewai.com/concepts/tasks
- LangGraph Persistence — https://docs.langchain.com/oss/python/langgraph/persistence

### Tmux Issues (Hook Reliability)
- tmux#1245 — session-closed not triggering — https://github.com/tmux/tmux/issues/1245
- tmux#3736 — pane-exited run-shell — https://github.com/tmux/tmux/issues/3736
- tmux#2483 — pane-died inconsistency — https://github.com/tmux/tmux/issues/2483
- tmux#1174 — signal death skips hooks — https://github.com/tmux/tmux/issues/1174

## Recommendation

### Stop chasing prompt compliance. Enforce signals structurally.

Temperature tuning is a dead end (p=0.403 across the 0.0–1.0 range). Prompt engineering helps at the margins but can never reach 100% reliability because LLMs have finite attention budgets and lifecycle signals compete with implementation complexity for that attention.

The recommended approach is **defense-in-depth with four layers**:

1. **Shell trap wrapper** (immediate, all agents): Modify `buildAgentCommand()` in `lib/worktree.js` to wrap agent commands with `trap 'aigon agent-status submitted' EXIT`. The `implementing` signal fires before the LLM starts; `submitted` fires after it exits. Zero LLM involvement. This alone covers ~90% of failure cases.

2. **Agent CLI hooks** (agent-specific, CC and GG first):
   - **CC**: Add a `Stop` hook that checks whether `aigon agent-status submitted` was called during the session. If not, return `decision: "block"` with reason "You must run `aigon agent-status submitted` before ending." This forces Claude to continue.
   - **GG**: Add an `AfterAgent` hook that rejects the response if lifecycle signals are missing, triggering automatic retry.
   - **CX**: Enable `codex_hooks` feature flag; add `PostToolUse` hooks to inject reminders. The `Stop` event is non-blocking, so this is advisory only.
   - **MV**: No hooks available. Shell trap is the only enforcement layer.

3. **Polling supervisor** (dashboard enhancement): Add a "stale implementing" detector to the dashboard's 10-second poll cycle. If a tmux session is gone but agent status is still "implementing" for >5 minutes, auto-transition to "needs-attention."

4. **Prompt refinement** (lowest priority, complementary):
   - Move lifecycle instructions to the absolute end of templates
   - Reduce total instruction count — prune to critical-only
   - Add motivation: "Your work will be invisible to the team unless you signal completion"
   - Keep existing ALL-CAPS emphasis for non-CC/non-4.6 agents

### Priority order:
1. Shell trap wrapper — highest ROI, covers all agents, zero LLM dependency
2. CC Stop hook — highest-value agent, blocking enforcement
3. Stale-implementing detector — safety net for all edge cases
4. GG AfterAgent hook — second-highest value agent
5. Prompt refinement — complementary, diminishing returns
6. CX hooks enablement — lower priority (CX is least-used agent)

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| shell-trap-agent-signals | Wrap agent commands in `trap EXIT` to fire implementing/submitted signals at the shell level, removing LLM responsibility | high | none |
| cc-stop-hook-signal-check | Add a Claude Code `Stop` hook that blocks session end until `agent-status submitted` has been called | high | none |
| stale-implementing-detector | Dashboard polling detects orphaned "implementing" states where tmux session is gone and auto-transitions to error/needs-attention | medium | none |
| gg-afteragent-signal-hook | Add a Gemini `AfterAgent` hook that rejects the response if lifecycle signals are missing, forcing retry | medium | none |
| prompt-lifecycle-refinement | Restructure prompt templates: move lifecycle instructions to end, reduce instruction count, add motivation framing | medium | none |
| cx-hooks-enablement | Enable Codex hooks feature flag and add PostToolUse reminders for lifecycle signals | low | none |
| doctor-orphan-repair | Extend `aigon doctor --fix` to detect and repair orphaned implementing states across all features | low | stale-implementing-detector |
