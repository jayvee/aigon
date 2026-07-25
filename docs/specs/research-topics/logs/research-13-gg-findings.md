---
status: submitted
updated: 2026-03-17T02:24:35.825Z
---

# Research Findings: ai development effectiveness

**Agent:** Gemini (gg)
**Research ID:** 13
**Date:** 2026-03-17

---

## Key Findings

### 1. Token Efficiency
- "Tokens per feature" is a valuable metric to measure the economic and technical efficiency of AI coding assistants.
- **Why it matters:** It reveals the "hidden cost" of AI development. An AI that solves a problem in 500k tokens is far less efficient (and more costly/slower) than one that does it in 50k tokens.
- **Trend > Absolute:** The trend of tokens per feature over time is more valuable than any single number, as it can indicate improved developer prompting, better spec writing, or better context management.
- **Capturing Token Usage:**
  - **Claude Code:** Can capture granular metrics (input, output, cache read tokens) via OpenTelemetry by setting `CLAUDE_CODE_ENABLE_TELEMETRY=1`.
  - **Cursor:** Exposes real-time tracking via a private Dashboard API (`https://www.cursor.com/api/usage`) or can be hooked via `.cursor/hooks.json` (though full token counts may require API querying).

### 2. Interaction Overhead
- **Turn Count / Message Count:** In agent evaluation, turn count (the number of back-and-forth exchanges) is used as a proxy for both cost and efficiency. A lower turn count for a successful task generally indicates higher interaction quality and better agent autonomy.
- **Validation Bottleneck:** As AI writes code faster, the bottleneck shifts to human validation. If an agent requires 20 turns of corrections, the overhead of reviewing those 20 iterations outweighs the time saved in writing.
- **Spectrum:** Chat-based tools have high manual interaction overhead. Delegated autonomous agents (like Devin or intent-based workflows) have low interaction but require higher trust and verification.

### 3. Git Signals
- **Commit Count & Churn:** A high commit count per feature, especially with high churn in the same files, strongly indicates "thrashing"—the AI (or user) is struggling to converge on a working solution.
- **Rework:** Reverts, frequent "fix" commits, or rapid iterations on identical files represent unproductive interaction and a lack of initial clarity or agent capability.
- 1-3 well-structured commits per feature usually reflect a "clean autonomous" or smoothly paired session, whereas 10+ small, unstructured commits often point to iterative prompting struggles.

### 4. Competitive Landscape & Naming
- **DX AI Measurement Framework:** Uses a methodology based on Utilization (Adoption), Impact (Time savings, cycle time), and Cost/ROI. DX strongly advocates for "Same-Engineer Analysis" (comparing a dev's AI performance to their own baseline) rather than team comparisons, to avoid gaming the system.
- **Cadence:** Focuses on AI workflow reliability metrics—Success/Failure rates, end-to-end latency, and decision task latency.
- **Naming:** Given Aigon's focus on individual developer optimization, names like "AI Development Effectiveness (ADE)", "Amplification Score", or "Leverage Score" are strong. "Leverage Score" effectively communicates how much the individual developer is amplifying their output through AI without feeling judgmental.

## Sources
- DX AI Measurement Framework: https://getdx.com/
- OckBench (Tokens vs. Quality research)
- Claude Code OpenTelemetry Docs: Exposes `claude_code.api_request`
- Cursor `.cursor/hooks.json` & Dashboard API (`https://www.cursor.com/api/usage`)

## Recommendation

Aigon should prioritize **"Leverage Score"** as the primary composite metric for individual developer effectiveness, combining token efficiency and interaction overhead.
1. **Token Efficiency:** Aigon should capture total token usage per feature (input + output) by integrating with Claude Code OpenTelemetry and Cursor Dashboard API. Displaying the trend of tokens per feature will incentivize better, more concise specs.
2. **Interaction Overhead (Turn Count):** Aigon should log the number of distinct prompts/turns a developer issues to an agent per feature.
3. **Thrashing Detection:** Use Git signals to detect high file churn and excessive commits, flagging these as "high-friction" implementations that dragged down the Leverage Score.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| telemetry-claude-code | Integrate Claude Code OpenTelemetry to capture token usage per session | high | none |
| metric-interaction-turns | Track and visualize the number of agent turns/prompts per feature | high | none |
| git-thrashing-detector | Analyze feature branch git history for high churn and rework patterns | medium | none |
| metric-leverage-score | Calculate a composite "Leverage Score" based on cycle time, tokens, and turns | medium | telemetry-claude-code, metric-interaction-turns |