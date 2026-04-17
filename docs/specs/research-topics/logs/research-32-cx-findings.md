# Research Findings: investigate paperclip agent invocation

**Agent:** Codex (cx)
**Research ID:** 32
**Date:** 2026-04-17

---

## Key Findings

### 1. How Paperclip invokes AI coding CLIs

Paperclip uses adapter packages that each expose an `execute()` function. The server heartbeat service calls the adapter, and the adapter spawns the local CLI as a child process with explicit `cwd`, env, timeout, and prompt stdin rather than using tmux or a long-lived shell wrapper. This is the core control-plane pattern described in Paperclip's architecture docs and implemented in the adapter code.  
Sources: https://docs.paperclip.ing/start/architecture, https://docs.paperclip.ing/adapters/overview, [packages/adapter-utils/src/server-utils.ts](/Users/jviner/src/paperclip/packages/adapter-utils/src/server-utils.ts:1043), [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:324), [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:217)

Claude invocation details:
- Builds env from Paperclip identity plus wake/workspace metadata such as `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WORKSPACE_*`, and optional auth token injection.
- Starts `claude` with `--print - --output-format stream-json --verbose`.
- Adds resume via `--resume <sessionId>` when the saved session cwd still matches.
- Appends skills with `--add-dir <tmp/.claude/skills>` and can inject instructions with `--append-system-prompt-file`.
- Defaults `dangerouslySkipPermissions` to true for unattended runs.  
Sources: https://docs.paperclip.ing/adapters/claude-local, [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:119), [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:437)

Codex invocation details:
- Builds the same Paperclip identity/wake/workspace env and also sets a managed `CODEX_HOME`.
- Injects Paperclip skills into the Codex skills home via symlinks.
- Starts `codex exec --json` and, when resuming, uses `resume <sessionId> -`.
- Supports `--search`, model override, reasoning effort config, and bypass flags.
- Sends the composed heartbeat prompt on stdin.  
Sources: https://docs.paperclip.ing/adapters/codex-local, [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:271), [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:502)

### 2. How Paperclip tracks running-agent status

Paperclip does not rely on tmux session names, shell traps, or touched heartbeat files the way Aigon does. It tracks execution in the server through:
- `heartbeat_runs` rows for queued/running/succeeded/failed/timed_out state, exit code, signal, usage, result JSON, session IDs, pid, retry metadata, and log references.
- An in-memory `runningProcesses` map keyed by run ID for the live child handle.
- Per-agent runtime state in `agent_runtime_state`.
- Per-task resumable session state in `agent_task_sessions`.
- Incremental run events and persisted stdout/stderr logs.  
Sources: [packages/db/src/schema/heartbeat_runs.ts](/Users/jviner/src/paperclip/packages/db/src/schema/heartbeat_runs.ts:6), [packages/db/src/schema/agent_runtime_state.ts](/Users/jviner/src/paperclip/packages/db/src/schema/agent_runtime_state.ts:5), [packages/db/src/schema/agent_task_sessions.ts](/Users/jviner/src/paperclip/packages/db/src/schema/agent_task_sessions.ts:6), [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:264), [server/src/services/run-log-store.ts](/Users/jviner/src/paperclip/server/src/services/run-log-store.ts:30)

Operationally, status is a mix of:
- Process monitoring while the child is live.
- DB state transitions as the authoritative record.
- A stale-run reaper that notices detached or lost child processes and marks or retries them.  
Sources: [packages/adapter-utils/src/server-utils.ts](/Users/jviner/src/paperclip/packages/adapter-utils/src/server-utils.ts:1064), [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:2349)

### 3. How completion and failure are detected

Completion is child-process exit plus adapter parsing, not an explicit agent-side `submitted` signal like Aigon's `aigon agent-status submitted`. The adapter returns structured result data, then the heartbeat service marks the run `succeeded`, `failed`, `cancelled`, or `timed_out`, stores result/session/log metadata, and updates runtime/task session state.  
Sources: [packages/adapter-utils/src/server-utils.ts](/Users/jviner/src/paperclip/packages/adapter-utils/src/server-utils.ts:1136), [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:3234)

Failure modes handled explicitly:
- Timeout: child gets `SIGTERM`, then `SIGKILL` after grace.  
  Source: [packages/adapter-utils/src/server-utils.ts](/Users/jviner/src/paperclip/packages/adapter-utils/src/server-utils.ts:1086)
- Missing/unknown session on resume: both Claude and Codex retry once with a fresh session.  
  Sources: [packages/adapters/claude-local/src/server/parse.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/parse.ts:170), [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:617), [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:618)
- Lost child process after server restart / handle loss: mark failed and queue one automated retry if eligible.  
  Sources: [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:2381), [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:2079)

### 4. How context and instructions are passed in

Paperclip passes context in three layers:

1. Environment variables for identity and runtime metadata.  
Examples: `PAPERCLIP_RUN_ID`, `PAPERCLIP_API_KEY`, task/wake identifiers, linked issue IDs, workspace location, runtime services.  
Sources: [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:155), [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:292)

2. Prompt composition on stdin.  
The prompt can include:
- a base prompt template,
- a bootstrap prompt for first run only,
- a rendered wake payload / resume delta,
- a session handoff note when sessions are rotated,
- optional instructions file contents.  
Sources: [packages/adapter-utils/src/server-utils.ts](/Users/jviner/src/paperclip/packages/adapter-utils/src/server-utils.ts:361), [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:405), [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:441)

3. Runtime-injected skills.  
Claude gets a temporary `.claude/skills` directory passed with `--add-dir`; Codex gets symlinked skills inside the active `CODEX_HOME/skills`.  
Sources: https://docs.paperclip.ing/adapters/claude-local, https://docs.paperclip.ing/adapters/codex-local, [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:44), [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:152)

### 5. How results and artifacts are collected

Paperclip collects several result layers after each run:
- Full stdout/stderr event stream persisted as NDJSON through `RunLogStore`.
- Small stdout/stderr excerpts and parsed `resultJson` on the `heartbeat_runs` row.
- Usage and cost summary stored in `usageJson`.
- Persisted runtime session IDs and task session params for the next wake.
- Optional issue comment built from the run summary/result text.  
Sources: [server/src/services/run-log-store.ts](/Users/jviner/src/paperclip/server/src/services/run-log-store.ts:53), [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:3262), [server/src/services/heartbeat-run-summary.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat-run-summary.ts:16)

Important limitation: there is no first-class generic artifact bundle protocol here. Paperclip is strong on logs, summaries, session state, and issue comments, but weaker on arbitrary artifact harvesting than a job runner with explicit outputs.

### 6. Concurrency model

Paperclip supports multiple concurrent agent sessions at the system level and per agent with controls:
- Many agents can run at once across the system.
- Per-agent execution is guarded by a start lock.
- Queued heartbeats are claimed in order.
- `heartbeat.maxConcurrentRuns` controls how many runs one agent may execute concurrently, clamped to 1..10.  
Sources: [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:67), [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:309), [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:2500)

Task coordination is stronger than Aigon's current session model because Paperclip also persists task-scoped session reuse and uses checkout semantics at the issue layer to avoid two agents working the same task.  
Sources: https://docs.paperclip.ing/guides/agent-developer/heartbeat-protocol, [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:1356)

### 7. Patterns Paperclip uses that Aigon does not, and could benefit from

Compared with Aigon's tmux + shell trap + status file + heartbeat-file model ([lib/worktree.js](/Users/jviner/src/aigon/lib/worktree.js:345), [lib/agent-status.js](/Users/jviner/src/aigon/lib/agent-status.js:73), [lib/workflow-heartbeat.js](/Users/jviner/src/aigon/lib/workflow-heartbeat.js:4), [lib/entity.js](/Users/jviner/src/aigon/lib/entity.js:804)), the highest-value Paperclip patterns are:

1. Authoritative run ledger.  
Paperclip has a DB row per execution attempt with pid, exit, error, session-before/session-after, retry lineage, and log refs. Aigon currently has agent status files plus workflow events, but not a single durable run record per session attempt.

2. Task-scoped resumable session state.  
Paperclip persists session params per task, not just per agent. That lets it resume the right context when a task wakes again and discard only the relevant task session on failure/rotation.

3. Explicit process-loss recovery.  
Paperclip treats "server lost the handle but the process exists" and "process disappeared" as separate cases, and retries the latter once automatically. Aigon mostly treats liveness as display plus shell-trap success/error, which is simpler but less recoverable.

4. Structured prompt layering.  
Paperclip separates bootstrap prompt, wake delta, instructions file, and handoff markdown. Aigon currently relies more on the agent command wrapper and the static template/prompt body.

5. Queue-based concurrency gates.  
Paperclip can queue and start the next eligible run with backpressure. Aigon's tmux model is oriented toward already-started sessions rather than queued resumable work items.

### 8. Anti-patterns / limitations Aigon should avoid copying

1. Do not copy the full heartbeat model for Aigon's current feature/research flows.  
Paperclip's short execution windows make sense for issue queues and autonomous companies, but they would add token churn and prompt rebuild overhead to Aigon's long-lived interactive tmux sessions.

2. Do not replace explicit agent lifecycle signals entirely.  
Paperclip can infer completion from process exit because the server owns the run. Aigon benefits from an explicit `agent-status submitted` because the user often keeps the session open after the work is done.

3. Do not depend on in-memory process maps without a stronger resume story.  
Paperclip mitigates this with DB rows and a reaper, but the in-memory handle is still a point of fragility on restart.

4. Do not assume logs equal artifacts.  
Paperclip stores logs and summaries well, but if Aigon wants richer outputs later, it should design explicit artifact/result records rather than inferring everything from stdout.

5. Treat docs as secondary to code for adapter details.  
One example: official `codex_local` docs mention `previous_response_id`, while current code persists a session/thread ID and resumes with `codex exec --json resume <id> -`. For this topic, code is the safer truth source.  
Sources: https://docs.paperclip.ing/adapters/codex-local, [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:502)

## Sources

- Official docs:
  - https://docs.paperclip.ing/start/architecture
  - https://docs.paperclip.ing/adapters/overview
  - https://docs.paperclip.ing/adapters/claude-local
  - https://docs.paperclip.ing/adapters/codex-local
  - https://docs.paperclip.ing/guides/agent-developer/heartbeat-protocol
- Paperclip code:
  - [packages/adapter-utils/src/server-utils.ts](/Users/jviner/src/paperclip/packages/adapter-utils/src/server-utils.ts:1043)
  - [packages/adapter-utils/src/session-compaction.ts](/Users/jviner/src/paperclip/packages/adapter-utils/src/session-compaction.ts:1)
  - [packages/adapters/claude-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/execute.ts:324)
  - [packages/adapters/claude-local/src/server/parse.ts](/Users/jviner/src/paperclip/packages/adapters/claude-local/src/server/parse.ts:7)
  - [packages/adapters/codex-local/src/server/execute.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/execute.ts:217)
  - [packages/adapters/codex-local/src/server/parse.ts](/Users/jviner/src/paperclip/packages/adapters/codex-local/src/server/parse.ts:3)
  - [server/src/services/heartbeat.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat.ts:264)
  - [server/src/services/run-log-store.ts](/Users/jviner/src/paperclip/server/src/services/run-log-store.ts:30)
  - [server/src/services/heartbeat-run-summary.ts](/Users/jviner/src/paperclip/server/src/services/heartbeat-run-summary.ts:16)
  - [packages/db/src/schema/heartbeat_runs.ts](/Users/jviner/src/paperclip/packages/db/src/schema/heartbeat_runs.ts:6)
  - [packages/db/src/schema/agent_task_sessions.ts](/Users/jviner/src/paperclip/packages/db/src/schema/agent_task_sessions.ts:6)
  - [packages/db/src/schema/agent_runtime_state.ts](/Users/jviner/src/paperclip/packages/db/src/schema/agent_runtime_state.ts:5)
- Aigon comparison points:
  - [lib/worktree.js](/Users/jviner/src/aigon/lib/worktree.js:345)
  - [lib/agent-status.js](/Users/jviner/src/aigon/lib/agent-status.js:73)
  - [lib/workflow-heartbeat.js](/Users/jviner/src/aigon/lib/workflow-heartbeat.js:4)
  - [lib/entity.js](/Users/jviner/src/aigon/lib/entity.js:804)

## Recommendation

Recommendation: adopt a hybrid, not a Paperclip clone.

Options considered:

1. Keep Aigon's current tmux + file-signal model and only make small fixes.
Pros: minimal change, preserves current UX.
Cons: still weak on per-run durability, restart recovery, and task-scoped session history.

2. Import Paperclip's heartbeat/run architecture wholesale.
Pros: strongest queueing and recovery model.
Cons: wrong execution model for Aigon's long-lived interactive agent sessions; likely adds cost and complexity without matching user workflow.

3. Hybrid approach: keep tmux sessions and explicit `agent-status`, but add a durable run ledger plus task-scoped session metadata and targeted recovery.
Pros: captures the best parts of Paperclip while preserving Aigon's session UX.
Cons: more implementation work than small fixes, but much less architectural churn than a heartbeat rewrite.

Recommended option: 3.

Concretely, Aigon should:
- Keep tmux and explicit `agent-status` as the primary UX contract.
- Add a durable per-run record keyed by entity/agent/session attempt with pid, start/finish, exit reason, and log refs.
- Add task/entity-scoped resumable session metadata so a restarted agent can recover the right context instead of only generic liveness.
- Add a process-loss reaper with explicit states like `detached`, `lost`, and `retrying`.
- Adopt Paperclip-style prompt layering for resumed sessions: base instructions + delta/handoff note rather than full prompt replay.

It should not adopt heartbeat-triggered short-lived runs for normal feature/research execution.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| durable-agent-run-ledger | Persist one authoritative run record per agent session attempt with pid, exit state, timestamps, and log references. | high | none |
| entity-scoped-session-state | Store resumable session metadata per feature/research entity and agent so resumed sessions recover the correct context after restarts. | high | durable-agent-run-ledger |
| session-loss-recovery | Detect detached or lost agent processes and mark, retry, or surface them explicitly instead of relying only on tmux/file liveness. | high | durable-agent-run-ledger |
| resumed-session-handoff-prompts | Generate structured handoff/delta prompts for resumed sessions so agents do not need full prompt reinjection after interruption. | medium | entity-scoped-session-state |
| agent-run-log-store | Persist stdout/stderr event logs separately from status files so dashboard and debugging can inspect exact run history. | medium | durable-agent-run-ledger |
