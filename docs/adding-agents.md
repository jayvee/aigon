# Adding Agents

This guide provides a repeatable, structured process for adding new agents to aigon.

## Decision Tree

When classifying a new agent's launch type, answer the following 5 questions to determine the correct configuration:

1. **Prompt Delivery**: How does the agent receive its instructions? Does it read a file, or does it require prompt text injected via CLI arguments or TUI?
2. **Slash-command Support**: Does the agent support executing operations via a native slash-command in its chat/TUI interface (e.g., `/feature-do`)?
3. **--model Flag**: Does the agent's CLI support a flag for specifying the underlying LLM model to use?
4. **Interactive vs Batch**: Is the agent meant to run in a continuous interactive session (like a chat interface), or does it execute a batch task and exit?
5. **Transcript Telemetry**: Does the agent provide a way to export or stream its session transcript/telemetry for analysis?

## Launch Types

Based on the answers above, map the agent to one of the following launch types:

| Launch Type | Agents | Prompt Delivery | Session Behaviour |
| --- | --- | --- | --- |
| **Slash-command** | `cu` (Cursor), `cc` (Claude Code) | File-based or injected | Persistent interactive session, supports commands |
| **File-prompt** | `gg` (Gemini CLI) | Reads spec/prompt file | Batch execution or continuous, relies on file changes |
| **TUI-inject** | `op` (OpenDevin) | TUI interaction/injection | Terminal User Interface, session managed via UI |

## Key Files

When onboarding an agent, the following files and directories are critical:

- `templates/agents/`: Use `templates/feature-template-agent-onboard.md` to correctly fill out the `<id>.json` template.
- `lib/agent-registry.js`: Registers the agent configuration and its launch type within the workflow engine.
- `lib/worktree.js`: Manages the isolation environment (worktrees vs branches) based on the agent's requirements.
- `lib/config.js`: Parses and manages the tool's runtime settings, including agent-specific flags.
- `tests/integration/worktree-state-reconcile.test.js`: Add your test assertions here to ensure the agent's state reconciliation behaves correctly in the worktree environment.
