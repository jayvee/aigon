# Research Findings: investigate paperclip agent invocation

**Agent:** Claude (cc)
**Research ID:** 32
**Date:** 2026-04-17

---

## Key Findings

### 1. How Paperclip Invokes AI Coding CLIs

Paperclip uses a **plugin-based adapter architecture** where each CLI has a dedicated adapter package under `packages/adapters/` (claude-local, codex-local, gemini-local, cursor-local, opencode-local, pi-local). All adapters implement a common `ServerAdapterModule` interface with a single `execute()` entry point.

**Command construction (Claude adapter):**
```typescript
// packages/adapters/claude-local/src/server/execute.ts
const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
if (resumeSessionId) args.push("--resume", resumeSessionId);
if (dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
if (instructionsFilePath) args.push("--append-system-prompt-file", instructionsFilePath);
args.push("--add-dir", skillsDir);
```

Key insight: Paperclip runs Claude Code in **non-interactive `--print` mode** with `stream-json` output format. The prompt is piped via **stdin**, not passed as an argument. This gives structured, machine-parseable output rather than the terminal-interactive mode Aigon uses.

**Environment setup:**
```typescript
env.PAPERCLIP_RUN_ID = runId;
env.PAPERCLIP_AGENT_ID = agent.id;
env.PAPERCLIP_TASK_ID = wakeTaskId;
env.PAPERCLIP_WAKE_REASON = wakeReason;
env.PAPERCLIP_WORKSPACE_CWD = effectiveWorkspaceCwd;
env.PAPERCLIP_API_KEY = authToken; // Local JWT for API callbacks
```

The adapter also strips Claude Code nesting-guard env vars (`CLAUDECODE`, `CLAUDE_CODE_SESSION`, etc.) to allow launching Claude from within a Claude session.

### 2. How Paperclip Tracks Running Agent Sessions

Paperclip uses a **database-backed state model** rather than filesystem signals:
- `heartbeat_runs` table: tracks each execution run with status (`queued`, `running`, `succeeded`, `failed`, `cancelled`, `timed_out`), PID, timestamps, exit codes
- `agent_task_sessions` table: per-task session persistence (taskKey -> sessionId) enabling session reuse
- `agent_runtime_state` table: agent's current runtime state

**Process tracking:**
- A shared `runChildProcess()` utility (`packages/adapter-utils/src/server-utils.ts`) spawns processes via Node's `child_process.spawn()` with `shell: false`
- Running processes tracked in an in-memory `Map<runId, { child, graceSec }>`
- Stdout/stderr streamed in real-time via `onLog` callbacks (also fed to WebSocket for live UI)
- Output capped at 4MB total buffer, 32KB excerpt stored inline in DB

### 3. Completion and Failure Detection

**Primary mechanism:** Process exit code + structured output parsing.

The Claude adapter parses `stream-json` output line-by-line looking for:
- `type: "system", subtype: "init"` -> session ID and model
- `type: "assistant"` -> assistant text blocks
- `type: "result"` -> final result with usage, cost, summary

**Outcome determination is simple:**
```
timedOut?        -> "timed_out"
exitCode === 0   -> "succeeded"
otherwise        -> "failed"
```

**Special failure modes detected:**
- `isClaudeUnknownSessionError()` -> expired session, auto-retries with fresh session
- `isClaudeMaxTurnsResult()` -> max turns reached, clears session for next run
- `detectClaudeLoginRequired()` -> auth needed, returns `errorCode: "claude_auth_required"` with extracted login URL

### 4. Context/Instructions Delivery

Context is delivered through **three channels simultaneously:**

1. **Stdin prompt**: Assembled from template sections:
   ```typescript
   const prompt = joinPromptSections([
     renderedBootstrapPrompt,   // One-time bootstrap (skipped on session resume)
     wakePrompt,                // Why the agent was woken (new issue, comment, etc.)
     sessionHandoffNote,        // Context from a rotated session
     renderedPrompt,            // Main prompt template
   ]);
   ```
   On session resume, the bootstrap prompt is skipped (already in cache) and only the wake prompt + delta is sent — saving 5-10K tokens per heartbeat.

2. **Environment variables**: Rich context about workspace, task, wake reason, linked issues (see section 1).

3. **Skills injection**: A temp directory with `.claude/skills/` containing symlinks to Paperclip's skills, added via `--add-dir`. Cleaned up after run completes.

4. **Instructions file**: Optional `--append-system-prompt-file` for persistent agent instructions (also skipped on resume to avoid token waste).

### 5. Result and Artifact Collection

Results come from **parsed structured output**, not filesystem artifacts:
- `resultJson`: the final `type: "result"` event from stream-json
- `summary`: extracted from result text or concatenated assistant messages
- `usage`: token counts parsed from the result event
- `costUsd`: total cost from result event
- `sessionId`: extracted for future session resume

Paperclip does NOT:
- Read git diffs or commit history
- Look for specific files written by the agent
- Parse markdown logs

Everything the server needs comes from the CLI's structured output stream.

### 6. Concurrent Agent Sessions

Paperclip supports **configurable per-agent concurrency** (default 1, max 10):

```typescript
// server/src/services/heartbeat.ts
const availableSlots = Math.max(0, policy.maxConcurrentRuns - runningCount);
```

Key coordination patterns:
- **Per-agent start lock** (`withAgentStartLock()`): serializes run claiming to prevent race conditions
- **Atomic CAS claiming**: `UPDATE ... WHERE status='queued'` ensures no double-execution
- **Fire-and-forget execution**: claimed runs are executed async (not awaited), allowing parallel runs
- **FIFO queue**: queued runs processed in creation order

### 7. Error Handling, Retry, and Recovery

| Scenario | Detection | Handling |
|----------|-----------|---------|
| Non-zero exit | `exitCode !== 0` | Mark failed, store error message |
| Timeout | Configurable timer | SIGTERM -> grace period -> SIGKILL, mark timed_out |
| Process lost (PID gone) | `process.kill(pid, 0)` returns ESRCH | Mark failed, auto-retry once (`processLossRetryCount < 1`) |
| Expired session | `isClaudeUnknownSessionError()` | Immediately retry with fresh session (within same run) |
| Auth required | Regex on stdout/stderr | Return `claude_auth_required` error with login URL |
| Agent paused/terminated | Status check before start | Skip queued runs, don't start new ones |
| Server restart | `resumeQueuedRuns()` on startup | Resume queued runs; orphaned running runs reaped by `reapOrphanedRuns()` |

**Session compaction**: Sessions auto-rotate when thresholds are exceeded (max runs, max age, max tokens). On rotation, a handoff markdown is generated with previous session context.

### 8. Patterns Aigon Does NOT Currently Use (and Could Benefit From)

#### A. Structured CLI Output Parsing (`--print --output-format stream-json`)
**What it is:** Paperclip runs Claude Code in non-interactive print mode and parses the structured JSON stream for session IDs, usage, cost, and results.
**Aigon equivalent:** Aigon uses interactive terminal mode (tmux) with shell trap signals. Results come from filesystem artifacts (agent-status files, heartbeat touch files), not CLI output.
**Potential benefit:** Would give Aigon access to per-session token usage, cost, model info, and session IDs without parsing JSONL transcript files after the fact. The telemetry module (`lib/telemetry.js`) currently does expensive post-hoc transcript parsing.
**Trade-off:** Would require a fundamentally different execution model — no more interactive tmux sessions where the user can observe/intervene. May not be desirable for Aigon's developer-facing workflow.

#### B. Session Resume via `--resume <sessionId>`
**What it is:** Paperclip captures session IDs from output and reuses them across heartbeat runs, avoiding cold-start prompt costs on each wake.
**Aigon equivalent:** Each agent invocation is a fresh session. There's no session continuity across runs.
**Potential benefit:** Could significantly reduce token costs for features that require multiple agent interactions. The bootstrap prompt (CLAUDE.md, project context) would be cached.
**Trade-off:** Session resume depends on `--print` mode. In Aigon's interactive model, the user/agent already has session continuity within a single tmux session.

#### C. Stdin Prompt Delivery
**What it is:** Paperclip pipes the full prompt via stdin rather than relying on slash commands, skill discovery, or argument passing.
**Aigon equivalent:** Aigon uses slash commands (`/aigon:feature-do 42`) which depend on the agent's command discovery mechanism.
**Potential benefit:** More reliable, bypasses agent-specific command discovery issues (the cx `/prompts:` bug, for instance). The `agent-prompt-resolver.js` already inlines prompts for cx — extending this pattern to stdin delivery for `--print` mode would be consistent.
**Trade-off:** Only works with `--print` mode. In interactive mode, the user needs the slash command interface.

#### D. Process-Loss Detection and Auto-Retry
**What it is:** Paperclip periodically checks if child PIDs are still alive (`process.kill(pid, 0)`). If a process is lost (server restart, OOM kill), it auto-retries once.
**Aigon equivalent:** Aigon has heartbeat files for liveness display, and the supervisor detects stale sessions. But it never auto-retries — users manually restart failed agents.
**Potential benefit:** For AutoConductor (autonomous) mode, auto-retry on process loss would improve reliability. A single retry with backoff could recover from transient crashes without human intervention.
**Trade-off:** Aigon's interactive model means the user is often watching. Auto-retry in Drive mode could be confusing. Best suited for Fleet/autonomous mode only.

#### E. Concurrent Run Slots with Queue Management
**What it is:** Paperclip has a proper run queue with configurable max concurrent slots per agent, atomic CAS claiming, and FIFO ordering.
**Aigon equivalent:** Aigon launches Fleet agents in parallel tmux sessions but has no queue/slot management. If an agent fails, nothing queues a replacement.
**Potential benefit:** A lightweight queue could let AutoConductor manage agent restarts and limit concurrency (e.g., don't start evaluation while implementation is still running).
**Trade-off:** Aigon's simpler tmux model works well for small Fleet sizes. Queue management adds complexity that may not be justified at the current scale.

#### F. Nesting Guard Env Var Stripping
**What it is:** Paperclip strips `CLAUDECODE`, `CLAUDE_CODE_SESSION`, etc. from the child process environment to allow launching Claude Code from within a Claude Code session.
**Aigon equivalent:** Aigon does not strip these. If a user runs `aigon feature-start` from within a Claude Code session, the spawned agent may fail with "cannot be launched inside another session."
**Potential benefit:** Simple fix that prevents a confusing failure mode.
**Trade-off:** Minimal. Just needs to be added to `buildAgentCommand` or the tmux launch wrapper.

### 9. Anti-Patterns or Limitations to Avoid

#### A. Monolithic Heartbeat Service
Paperclip's `heartbeat.ts` is ~4,500 lines and handles run queuing, execution, session management, process monitoring, workspace provisioning, issue workflow, and more. This is their "god module." Aigon's separation into smaller focused modules (worktree.js, agent-status.js, workflow-heartbeat.js, feature-review-state.js) is healthier.

#### B. Database-Heavy Architecture
Paperclip requires a database (SQLite/Postgres via Drizzle ORM) for all state. This adds operational complexity. Aigon's filesystem-based state (event logs, snapshots, signal files) is simpler to debug, version-control, and reason about. The trade-off is that Paperclip gets atomic queries and relational integrity, but for a developer-local tool, Aigon's approach is more appropriate.

#### C. Non-Interactive Execution Only
Paperclip agents run in `--print` mode with no human observation or intervention possible during execution. This is appropriate for their "autonomous company" model but would be a regression for Aigon users who value the ability to watch agents work in tmux and intervene if needed.

#### D. `dangerouslySkipPermissions` as Default
Paperclip defaults `dangerouslySkipPermissions` to `true`. While pragmatic for autonomous operation, this removes a safety layer. Aigon's approach of configuring specific allowed tools in `.claude/settings.json` is more principled.

#### E. Over-Generous Session Retry
Paperclip automatically retries on expired sessions within the same run. While smart, Aigon should be cautious about hidden retries — they can mask bugs (e.g., an agent that consistently fails might look like it just takes longer).

## Sources

- `~/src/paperclip/packages/adapters/claude-local/src/server/execute.ts` — Claude adapter execution logic
- `~/src/paperclip/packages/adapters/claude-local/src/server/parse.ts` — Stream-JSON output parser
- `~/src/paperclip/packages/adapter-utils/src/server-utils.ts` — Shared process management (`runChildProcess()`)
- `~/src/paperclip/server/src/services/heartbeat.ts` — Server orchestration (run queue, execution, reaping)
- `~/src/paperclip/packages/shared/src/constants.ts` — Status enums and constants
- `~/src/paperclip/packages/db/src/schema/` — Database schema (heartbeat_runs, agent_task_sessions, agent_runtime_state)

## Recommendation

Aigon should adopt three patterns from Paperclip in the near term, ordered by impact-to-effort ratio:

1. **Nesting guard env var stripping** (trivial, prevents real user-facing bug)
2. **Process-loss detection for AutoConductor** (moderate effort, improves autonomous reliability)
3. **Structured output mode as an alternative execution path** (significant effort, but unlocks real-time cost/usage tracking and session resume — most impactful for Fleet/autonomous mode)

Aigon should NOT adopt Paperclip's database-centric architecture, non-interactive execution model, or monolithic service patterns. The filesystem-based, tmux-interactive model is a competitive advantage for developer experience.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| strip-nesting-env-vars | Strip Claude Code nesting guard env vars (CLAUDECODE, CLAUDE_CODE_SESSION, etc.) from spawned agent processes to prevent "cannot launch inside session" errors | high | none |
| auto-conductor-process-loss-retry | Detect agent process loss via PID check in AutoConductor and auto-retry once before marking as failed | medium | none |
| structured-output-execution-mode | Add an alternative execution path using `claude --print --output-format stream-json` for non-interactive runs, enabling real-time cost/usage tracking and session resume | medium | none |
| session-resume-support | Capture and reuse Claude Code session IDs across successive agent invocations to avoid cold-start token costs | low | structured-output-execution-mode |
| agent-run-queue | Add a lightweight run queue to AutoConductor with configurable concurrency slots and FIFO ordering for agent execution | low | none |
