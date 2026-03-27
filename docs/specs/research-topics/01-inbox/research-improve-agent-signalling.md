# Research: improve-agent-signalling

## Context

Some agents (particularly Codex) inconsistently execute critical lifecycle signals — `aigon agent-status implementing`, `aigon agent-status submitted`, and dev server commands — after completing feature work. These signals are essential for the Aigon state machine and dashboard to reflect accurate workflow state. When agents skip them, manifests go stale, the board shows incorrect status, and human intervention is needed to unstick the pipeline.

This is fundamentally an instruction-following reliability problem. The current approach relies entirely on LLM prompt compliance: the agent is told to run these commands, and sometimes it doesn't. We need to understand why signals get dropped and evaluate strategies — from prompt engineering to architectural changes — that improve reliability without sacrificing implementation quality.

Initial analysis suggests temperature tuning has limited impact (it makes models more deterministic about what they were *already* going to do, not more compliant). More promising directions include structural enforcement (wrapping signals in the launch/exit shell flow), prompt positioning (recency bias), and post-exit verification hooks.

## Questions to Answer

### Understanding the Problem
- [ ] Which agents drop signals most frequently? Is it primarily Codex, or do CC/GG/MV also fail?
- [ ] Which specific signals get dropped? Is it `agent-status submitted` (end), `agent-status implementing` (start), dev-server, or all of them?
- [ ] Is there a correlation between task complexity/prompt length and signal-dropping frequency?
- [ ] Do agents that drop signals show any common pattern (e.g., early termination, error exit, context window exhaustion)?

### Temperature & Sampling
- [ ] Does lowering temperature (0.3-0.6) measurably improve lifecycle signal compliance for Codex?
- [ ] What is the trade-off curve between temperature and implementation quality for coding tasks?
- [ ] Do different models (gpt-5.3-codex vs gpt-5.4 vs Claude) respond differently to temperature adjustments for procedural compliance?
- [ ] Is there a "sweet spot" temperature per agent/model that balances creativity with compliance?

### Prompt Engineering
- [ ] Does moving the mandatory exit checklist to the last 3-5 lines of the prompt (recency anchoring) improve compliance?
- [ ] Does reducing total instruction count (separating CRITICAL vs nice-to-have) improve compliance on critical items?
- [ ] Does stronger framing language (MUST/REQUIRED/FAILURE MEANS WORK IS LOST) have measurable impact?
- [ ] Would a structured "pre-flight / post-flight checklist" format work better than inline instructions?

### Structural Enforcement
- [ ] Can lifecycle signals be wrapped into the shell launch flow (`buildAgentCommand()` in `lib/worktree.js`) so they happen outside the LLM's responsibility?
- [ ] Which signals can be fully externalized (shell-level) vs which require LLM awareness (e.g., "run dev server and verify it works")?
- [ ] Can we detect agent process exit and auto-set `submitted` status if the agent forgot?
- [ ] Would a post-exit verification hook (check manifest, alert/auto-fix if missing) be sufficient as a safety net?

### Agent-Specific Considerations
- [ ] Does the Codex CLI support temperature, system prompt injection, or other knobs we're not currently using?
- [ ] Are there agent-specific config options (beyond temperature) that affect instruction-following reliability?
- [ ] Would breaking the prompt into phases (implement → then lifecycle) via multi-turn or chained invocations help?

## Scope

### In Scope
- All agents in the Aigon fleet (cc, cx, gg, mv) and their signal compliance patterns
- Temperature and sampling parameter effects on instruction-following
- Prompt structure and positioning strategies for critical instructions
- Architectural alternatives: shell-level enforcement, post-exit hooks, verification polling
- The specific signals: `agent-status`, dev-server lifecycle, commit conventions
- Measuring and comparing approaches (defining what "reliable" means quantitatively)

### Out of Scope
- Changing the fundamental state machine or manifest architecture
- Agent-to-agent communication protocols (separate concern)
- Model fine-tuning or training custom models for compliance
- Redesigning the Aigon workflow itself (this is about making existing signals reliable)

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
