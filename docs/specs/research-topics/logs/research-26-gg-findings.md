# Research Findings: improve agent signalling

**Agent:** Gemini (gg)
**Research ID:** 26
**Date:** 2026-03-29

---

## Key Findings

### Understanding the Problem

*   **Signal Dropping by Agent:** An analysis of telemetry data reveals that the `cx` (Codex) agent is the primary offender in dropping lifecycle signals, with 5 documented failures compared to 1 each for `cc` (Claude) and `gg` (Gemini).
*   **Type of Failure:** The most common failure is the omission of the final `aigon agent-status submitted` signal. This is often part of a larger "wrap-up" failure, where the agent completes the core coding task but fails to commit its work or even create a log file. In 3 of the 5 `cx` failures, no log file was generated at all, indicating a catastrophic failure early in the execution.
*   **Task Complexity Correlation:** The available telemetry data does not contain information about task complexity or prompt length, so no correlation could be established.

### Temperature & Sampling

*   **Low Temperature for Reliability:** Industry best practices and research indicate that lower temperature settings (e.g., `< 0.7`) lead to more deterministic and reliable behavior, which is crucial for instruction following. For coding and other high-precision tasks, temperatures as low as 0.0 are recommended.
*   **Trade-off:** The trade-off for increased reliability is reduced "creativity". For the tasks that are failing (lifecycle commands), creativity is not desired, so a lower temperature is a clear win.
*   **Model-specific Responses:** Different models respond differently to temperature adjustments. Larger, more capable models tend to be more robust at higher temperatures.

### Prompt Engineering

*   **Structure is Key:** Structured prompts, such as a "pre-flight / post-flight checklist" or the use of clear delimiters and sections, are more effective than long, unstructured instructions.
*   **Clarity over Emotion:** Clear, atomic, and unambiguous instructions are more effective than using strong but vague language like "MUST" or "REQUIRED". Explicitly stating what the model *should not* do is also a powerful technique.
*   **Phased Execution:** Breaking a complex task into smaller, chained prompts (e.g., "implement", then "commit", then "signal completion") is a highly recommended strategy to prevent "instruction drift".

### Structural Enforcement

*   **Externalize Signals:** It is possible to wrap the agent execution in a script that handles some lifecycle signals externally.
    *   `aigon agent-status implementing` can be run before the agent starts.
    *   `aigon agent-status submitted` can be run after the agent exits successfully.
*   **Agent Awareness:** Some tasks, like verifying a dev server started correctly or writing a good commit message, require the agent's cognitive abilities and cannot be fully externalized.
*   **Safety Net:** A post-exit verification hook that checks for inconsistencies (e.g., an `implementing` agent with no running process) would be a valuable safety net to catch failures.

### Agent-Specific Considerations (Codex)

*   **Codex CLI has Knobs:** The `codex` CLI supports a `--temperature` flag, and also has a structured `exec --json` mode that provides an event stream. It also has a `resume` capability.
*   **No Hooks:** The `codex` CLI does not have a built-in hook system, which is a known limitation.
*   **Opportunity for Structured Orchestration:** The `exec --json` and `resume` features of the `codex` CLI present an opportunity to move from a chat-based interaction to a more reliable, structured orchestration model where `aigon` can manage the agent through distinct phases.

## Sources

*   `google_web_search: large language model temperature instruction following reliability`
*   `google_web_search: prompt engineering techniques for instruction following reliability`
*   `google_web_search: OpenAI Codex CLI documentation temperature`
*   `lib/worktree.js`
*   `.aigon/telemetry/` directory and its contents.
*   `docs/specs/features/logs/`

## Recommendation

Based on the findings, a multi-pronged approach is recommended:

1.  **Immediate Mitigation (Low-Hanging Fruit):**
    *   **Lower Temperature for `cx`:** Immediately lower the temperature setting for the `cx` agent to a value between 0.2 and 0.5 for its implementation tasks. This is a simple change that is highly likely to improve reliability.
    *   **Refine Prompts:** Update the prompts for all agents, but especially `cx`, to use a more structured "checklist" format for the final steps (commit, log, signal).

2.  **Medium-Term Solution (Architectural Improvement):**
    *   **Implement a Wrapper Script:** Create a shell script that wraps the agent execution. This script should:
        1.  Run `aigon agent-status implementing`.
        2.  Execute the agent.
        3.  On successful exit (exit code 0), run `aigon agent-status submitted`.
    *   This change moves the responsibility for these critical signals from the LLM to the `aigon` tool, which is inherently more reliable.

3.  **Long-Term Solution (Codex-Specific):**
    *   **Adopt `codex exec --json`:** For the `cx` agent, migrate from the current chat-based interaction to the `codex exec --json` mode. This will allow `aigon` to orchestrate the agent in a structured way, receiving events and sending commands programmatically. This is the most reliable way to interact with the Codex agent and will eliminate the instruction-following problem for `cx` entirely.

This tiered approach allows for immediate improvements while paving the way for a more robust and reliable system architecture.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| lower-cx-temperature | Update the `cx` agent configuration to use a lower temperature (e.g., 0.3) for implementation tasks. | high | none |
| structured-exit-prompt | Refactor agent prompts to include a structured "post-flight checklist" for commit, log, and signal steps. | high | none |
| agent-wrapper-script | Create a script that wraps agent execution and handles `implementing` and `submitted` status signals externally. | medium | none |
| codex-exec-orchestrator | Implement a new orchestration mode for the `cx` agent that uses `codex exec --json` for structured interaction. | medium | agent-wrapper-script |
