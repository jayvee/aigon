# Research Findings: Paperclip Agent Invocation
Agent: Gemini (gg)
Topic: Research 32 - Investigate Paperclip Agent Invocation

## Overview
Paperclip orchestrates AI coding CLIs using a direct process-spawning approach via Node's `child_process.spawn`, acting as a central API server that local adapters interact with. It explicitly models agents as stateful sub-processes governed by strict timeouts, explicit environment isolation, and structured wake payloads.

## Answers to Research Questions

### 1. How does Paperclip invoke AI coding CLIs?
- **Mechanism:** It uses Node.js `child_process.spawn` (in `runChildProcess` helper inside `@paperclipai/adapter-utils/src/server-utils.ts`).
- **Command Construction:** Supports complex PATH resolution, platform-specific wrapping (like using `cmd.exe` for `.bat` and `.cmd` on Windows), and shell-less execution (`shell: false`).
- **Environment Setup:** Crucially, it **strips nesting guards** from the environment (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION`, `CLAUDE_CODE_PARENT_SESSION`). This prevents Claude Code from aborting when spawned inside another environment that might have these variables set (e.g., a server started by Claude Code).
- **Core Env Vars:** Injects `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, and `PAPERCLIP_API_URL` to route the agent back to the server.

### 2. How does Paperclip track the status of a running agent session?
- **In-Memory Map:** Tracks active agents via a memory structure: `Map<string, { child: ChildProcess, graceSec: number }>` mapped by a UUID (`runId`).
- **Concurrency Locks:** Prevents overlapping spawns of the same agent using an async lock map (`startLocksByAgent: Map<string, Promise<void>>`).
- **DB Persistence:** Uses a Postgres database to track `heartbeatRuns` and `heartbeatRunEvents` to recover/detect orphaned runs across server restarts.

### 3. How does Paperclip detect agent completion or failure?
- **Event Listeners:** Listens to the `close` and `error` events on the child process.
- **Signals:** Captures `exitCode` and termination `signal`.
- **Timeouts:** Implements a strict `timeoutSec` configuration. If triggered, it initiates a cascading kill: sends `SIGTERM`, waits for `graceSec`, and if the process is still alive, sends `SIGKILL`.

### 4. How does Paperclip pass context/instructions to the agent CLI at launch?
- **Wake Payload Context:** Uses a structured "Wake Payload" rendered into a markdown prompt (`renderPaperclipWakePrompt`).
- **Data Included:** It includes the `reason` for waking, `issue` metadata, `executionStage`, and truncated thread comments. It intentionally defers full data fetching by instructing the agent to use the provided `PAPERCLIP_API_URL` if `fallbackFetchNeeded` is true.

### 5. How does Paperclip collect results or artifacts from a completed agent session?
- **Stdio Streaming:** Directly pipes `stdout` and `stderr`, streaming chunks to `onLog` callbacks.
- **Memory Buffering:** Buffers output in memory but strictly caps it to prevent OOM errors (`MAX_CAPTURE_BYTES = 4MB`).

### 6. Does Paperclip support multiple concurrent agent sessions?
- **Yes.** The system uses a concurrency gate (`HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT = 1`, configurable up to 10) to manage parallel runs. It tracks multiple separate `runId`s in its `runningProcesses` Map.

### 7. What error handling/recovery patterns are used?
- Explicitly handles `ENOENT` to provide better errors for missing PATH commands.
- Implements process recovery for "orphaned" processes (where the DB knew a process started, but the server restarted) to clean up DB state.
- Emits detailed warning logs instead of crashing when logging or metadata recording fails mid-flight.

## Implications for Aigon

### Patterns Aigon Could Benefit From:
- **Environment Isolation:** Stripping `CLAUDECODE` and similar nesting-guard environment variables is highly valuable. If Aigon ever runs agents from within nested environments, applying this pattern prevents sudden aborts.
- **Cascading Kills (`SIGTERM` -> `SIGKILL`):** Aigon currently uses shell traps and tmux session killing. Adopting a graceful `SIGTERM` followed by a hard `SIGKILL` after a grace period (e.g., 15s) could prevent file corruption during forceful shutdowns.
- **Async Concurrency Locks:** The `startLocksByAgent` pattern prevents race conditions when starting the same agent multiple times rapidly.
- **Strict Output Capping:** If Aigon captures logs into memory, enforcing a `MAX_CAPTURE_BYTES` ensures rogue looping agents do not crash the orchestrator.

### Anti-Patterns/Limitations Aigon Should Avoid:
- **In-Memory Primary Tracking:** Paperclip's `runningProcesses` Map is volatile. Aigon's current approach using explicit file markers (`.aigon/state/feature-{id}-{agent}.json`) is much more resilient to CLI crashes than an in-memory Map, since the state exists on disk.
- **Direct Stdio Pipes without Tmux:** While `child_process.spawn` with piped output is cleaner programmatically, it sacrifices the ability to attach a terminal to observe the agent live. Aigon's use of `tmux` is a feature that should be preserved for the developer experience, even if it adds complexity.
