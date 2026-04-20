# Findings: token-and-context-reduction (Gemini)

## 1. Fleet vs Solo Mode Cost Multiplier
- **Measured:** Based on aggregation of `.aigon/telemetry/` data, Fleet mode features average ~4.7 million input tokens vs ~2.33 million for Solo mode. This is roughly a 2× token volume multiplier, not 3×, likely due to shared discovery phases.
- **Measured:** Interestingly, the dollar cost per feature is nearly identical (~$18.27 Fleet vs ~$18.46 Solo). This indicates that while Fleet consumes more tokens, the inclusion of cheaper models (like Gemini 2.5 Flash and Codex) balances out the high cost of a solo Claude Opus/Sonnet run.
- **Confidence:** High (measured via existing telemetry artifacts).

## 2. Aigon Harness and Prompt Bloat
- **Measured:** `CLAUDE.md` is currently ~25KB (287 lines) and `AGENTS.md` is ~15KB. Combined, these inject thousands of tokens into the context window *on every single turn* across all agents.
- **Measured:** Core command templates are very large. `feature-do.md` is ~8.5KB and `feature-close.md` is ~9KB. They contain significant boilerplate ("Step 0: Verify your workspace") and placeholders that are parsed repeatedly.
- **Inference:** The "Step 0" and "Worktree execution rules" blocks in templates are re-read every session, creating a high floor for the token cost of any action. 
- **Confidence:** High (measured via file sizes).

## 3. Codex Configuration Sinks
- **Measured:** The global `~/.codex/config.toml` has swelled to 2,069 lines.
- **Inference:** If Codex loads this global config into the system prompt for every session, it acts as a massive baseline token sink. While we cannot easily prove the internal Codex prompt assembly from Aigon's logs, the sheer size of the file suggests it should be aggressively pruned.
- **Confidence:** Medium (file size is known, but exact context inclusion requires vendor-side inspection).

## 4. AutoConductor / Iteration Costs
- **Inference:** In Autopilot mode, AutoConductor spawns fresh agent sessions on every retry. Because the context is not distilled or carried forward efficiently, each iteration pays the full cold-start cost of loading the command template, `CLAUDE.md`, `AGENTS.md`, and the spec.

## Recommendations

1. **Prune Default Context Files (Quick Win - Feature):** Move the bulk of `CLAUDE.md` and `AGENTS.md` into on-demand skills or separate reference files (`docs/architecture.md`). Only retain the absolute minimum directives in the auto-loaded files.
2. **Trim Command Templates (Quick Win - Feature):** Refactor `templates/generic/commands/feature-do.md` and other large templates. Condense the mandatory rule blocks and ensure that `lib/agent-prompt-resolver.js` dynamically strips unused placeholder sections entirely before passing the prompt to the agent.
3. **Audit Codex Config Bloat (Medium Effort - Measurement):** Verify exactly how much of `~/.codex/config.toml` is passed as context. If the entire file is sent, refactor `aigon install-agent cx` to use a much smaller config and rely on local skill files instead.
4. **Session Handoffs in AutoConductor (Medium Effort):** Instead of fully cold-starting on every loop iteration, explore having AutoConductor pass a highly distilled summary of previous failures to a new session, skipping the generic preamble if possible.