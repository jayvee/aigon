# Research: Investigate Paperclip Agent Invocation

## Context

Paperclip is an open-source application that orchestrates AI coding CLIs (like Claude Code) to run specific agents as part of an autonomous agent-driven company. Aigon has similar needs — starting agent CLIs, tracking their status, signalling completion, and extracting results. Understanding how Paperclip solves these problems may reveal patterns or techniques that Aigon can adopt to improve its own agent invocation, lifecycle management, and signal handling.

The Paperclip repo is cloned locally at `~/src/paperclip` and public docs are at https://docs.paperclip.ing/.

## Questions to Answer

- [ ] How does Paperclip invoke AI coding CLIs (Claude Code, etc.)? What command construction, argument passing, and environment setup do they use?
- [ ] How does Paperclip track the status of a running agent session? (polling, heartbeats, process monitoring, IPC, etc.)
- [ ] How does Paperclip detect agent completion or failure? What signalling mechanism is used?
- [ ] How does Paperclip pass context/instructions to the agent CLI at launch? (prompts, files, environment variables, flags)
- [ ] How does Paperclip collect results or artifacts from a completed agent session?
- [ ] Does Paperclip support multiple concurrent agent sessions? If so, how does it coordinate them?
- [ ] What error handling, retry, or recovery patterns does Paperclip use when an agent CLI fails or hangs?
- [ ] Are there any patterns in Paperclip's approach that Aigon does NOT currently use and could benefit from?
- [ ] Are there any anti-patterns or limitations in Paperclip's approach that Aigon should avoid?

## Scope

**In scope:**
- Paperclip's agent CLI invocation code (how it shells out to Claude Code / other CLIs)
- Lifecycle management: start, monitor, signal, complete
- Context delivery and result extraction mechanisms
- Comparison with Aigon's current approach (shell traps, tmux sessions, heartbeat files, agent-status signals)

**Out of scope:**
- Paperclip's business logic, product features, or company simulation aspects
- Paperclip's UI/frontend beyond what's needed to understand agent orchestration
- Evaluating Paperclip as a product or competitor

## Inspiration / Starting Points

- Local clone: `~/src/paperclip`
- Public docs: https://docs.paperclip.ing/
- Aigon's current agent invocation: `lib/worktree.js` (buildAgentCommand, tmux sessions), `lib/agent-status.js` (signal files), `lib/workflow-heartbeat.js` (liveness), shell trap signals in `templates/agents/*.json`
