# Research Findings: tmux conductor

**Agent:** Gemini (gg)
**Research ID:** 06
**Date:** 2026-02-28

---

## Key Findings

This research evaluates the feasibility of using `tmux` as a session management layer for the Aigon Conductor feature. The goal is to enable headless agent execution while allowing developers to "jump in" and observe or interact with any agent on demand.

### Session Management Mechanics

*   **Monitoring Output with `capture-pane`**: `tmux capture-pane -p` is highly effective for scripting. It can capture the entire scrollback buffer (`-S -`) for review. The primary limitation is that the `history-limit` is set on pane creation and stored in RAM, so extremely large limits could consume significant memory. For monitoring, it's more reliable to check for specific output patterns in a loop than to assume a process is done.

*   **Detecting Agent State**: While `capture-pane` can be used to scrape the terminal for "Done" or "Error" messages, it's less reliable than the status-file approach from `feature-conductor.md`. A hybrid model is best: the conductor uses `tmux` to manage the session and can scrape the pane for real-time status, but relies on a definitive status file (`SUCCESS`, `FAILURE`, `NEEDS_INPUT`) written by the agent for critical state changes. Crash detection is simple: the conductor can poll `tmux lsp` to see if the agent's pane/process still exists.

*   **Performance Overhead**: The overhead of running 4-6 concurrent `tmux` sessions is negligible on modern hardware. `tmux` itself is extremely lightweight; the resource consumption will come from the agents (e.g., Node.js processes) running inside the panes, not the multiplexer.

*   **Interactive Automation with `send-keys`**: `tmux send-keys` is perfectly suited for this use case. The conductor can reliably send commands, approve permissions, or answer prompts by targeting a specific agent's pane. The best practice is to use a "wait-and-grep" loop on `capture-pane` output to ensure the prompt is visible before sending keys.

*   **`tmux` vs. Alternatives**:
    *   **`screen`**: Too dated; lacks the advanced scripting and pane management of `tmux`.
    *   **`zellij`**: A modern and user-friendly alternative, but it is less mature and not as ubiquitously installed. Its "batteries-included" approach is less aligned with Aigon's modular, scriptable nature.
    *   **`abduco+dvtm`**: Too minimalist and niche.
    *   **Conclusion**: `tmux` remains the ideal choice due to its stability, powerful scripting API, and widespread availability.

*   **Warp Terminal API**: Warp's programmatic control is focused on *creating* layouts via URI schemes and YAML files. It currently lacks a public API to script *existing* sessions (e.g., `send-keys`). This makes it unsuitable for the conductor's need to interact with live, headless agent sessions.

### Relationship to Conductor Spec

*   **Architecture**: `tmux` does not replace `spawn()`; it enhances it. The conductor would `spawn()` the agent process *inside a new, detached tmux session*. This provides the benefits of a background process (detachment) with the advantages of a virtual terminal (interaction, observation).

*   **Lifecycle Management**: `tmux` greatly simplifies this. `tmux kill-session` provides a robust way to terminate an agent and its entire process tree. The `respawn-pane` command could even be used to implement an automatic restart policy.

*   **Status Dashboard**: This is a strong use case for `tmux`. The conductor could create a "conductor" `tmux` window with pane 0 acting as a dynamic dashboard (e.g., running a `watch` command on status files) and panes 1-N attached to the live output of each running agent.

### Scope and UX

*   **Default Behavior**: For consistency, all autonomous agent sessions (`feature-implement`, `research-conduct`, etc.) should run in detached `tmux` sessions. This unifies the execution model. Interactive sessions would remain in the user's current terminal.

*   **"Jump In" UX**: 
    *   **Single Agent**: `tmux attach -t <session_name>` is the standard way to connect to one agent. Aigon should provide a simple wrapper command, like `aigon watch <feature-id> [agent-id]`, that finds the correct session and attaches to it.
    *   **Multi-Agent Dashboard**: For viewing multiple agents side-by-side (the "Warp-like" experience), a user can create a temporary viewing session and use `tmux join-pane` to pull in the live panes from multiple background agent sessions. This is a powerful feature for observability. Aigon should automate this with a command like `aigon dashboard <feature-id> --agents gg,cx`, which would create the temporary layout and destroy it on detach.

*   **Nested Sessions**: This is a common `tmux` issue. Aigon should mitigate this by launching its internal `tmux` server with a non-standard socket and prefix key to avoid conflicts with a user's own `tmux` instance.

*   **Notifications**: The conductor can easily send desktop notifications on macOS using `osascript`. This is the ideal mechanism for alerting the user when an agent is blocked and needs input.

### Competitive Landscape

*   Aider, OpenHands, and SWE-agent use different strategies (Git-based state, Docker sandboxes, research-focused trajectory files). None appear to use `tmux` for session management in the proposed "headless but attachable" way. This represents a unique and pragmatic architectural choice for Aigon, blending automation with developer observability.

---

## Sources

*   [tmux man page](https://man7.org/linux/man-pages/man1/tmux.1.html)
*   [Aider (Git-based Agent)](https://github.com/paul-gauthier/aider)
*   [OpenHands (formerly OpenDevin)](https://github.com/All-Hands-AI/OpenHands)
*   [SWE-agent](https://github.com/princeton-nlp/swe-agent)
*   [Scripting macOS desktop notifications](https://dev.to/jthayer/send-desktop-notifications-from-your-mac-terminal-1l4i)

---

## Recommendation

**Adopt `tmux` as the core session management layer for the Aigon Conductor.**

This approach provides a robust, scriptable, and low-overhead foundation for running multiple agents concurrently. It elegantly solves the "headless but attachable" requirement, allowing for both fully autonomous execution and on-demand developer intervention.

The implementation should:
1.  Launch each agent in a new, detached `tmux` session with a predictable name (e.g., `aigon-feature-06-claude`).
2.  Use a non-standard `tmux` socket file to avoid conflicts with the user's environment.
3.  Rely on a hybrid of `tmux` pane monitoring and agent-written status files to track state.
4.  Provide a simple `aigon watch <id> [agent-id]` command that attaches the user to a single agent's session.
5.  Provide a powerful `aigon dashboard <id> --agents <list>` command that automates the creation of a temporary, multi-pane viewing session for observing several agents at once.
6.  Use `osascript` to send desktop notifications when an agent requires manual input.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| conductor-tmux-session-manager | Core component to create, manage, and kill agent `tmux` sessions. | high | none |
| conductor-agent-watcher | A command (`aigon watch <id> [agent]`) for users to attach to a running agent's `tmux` session. | high | conductor-tmux-session-manager |
| conductor-multi-agent-dashboard | A command (`aigon dashboard`) to view multiple agents side-by-side in a temporary `tmux` layout. | high | conductor-agent-watcher |
| conductor-status-dashboard | A `tmux` window layout showing the real-time status of all running agents. | medium | conductor-tmux-session-manager |
| conductor-desktop-notifier | Sends a macOS notification when an agent's status changes to `NEEDS_INPUT`. | medium | conductor-tmux-session-manager |
| conductor-nested-tmux-safety | Use a custom socket and prefix to prevent conflicts with user's `tmux` config. | high | conductor-tmux-session-manager |
