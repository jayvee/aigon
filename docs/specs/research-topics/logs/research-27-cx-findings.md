# Research Findings: workflow engine signal architecture

**Agent:** Codex (cx)
**Research ID:** 27
**Date:** 2026-03-30

---

## Key Findings

### 1. Use explicit Aigon commands for semantic lifecycle, not shell exit

`signal.agent_ready` should come from `feature-submit` as the primary source of truth, and `signal.agent_failed` should come from explicit failure/reporting paths in Aigon. A shell `EXIT` trap is portable as a crash detector, but it is the wrong semantic source for "ready": agent exit means "session ended", not "work is valid, committed, and intentionally submitted".

Why:
- Aigon already models readiness semantically in command space: `feature-submit`, `agent-status submitted`, and the workflow engine's `signal.agent_ready`.
- Shell exit traps cannot distinguish success, operator stop, CLI crash, network auth failure, or a user intentionally leaving the session open after submission.
- The current repo already bridges legacy submit state into engine events during eval via `synthesizeAgentReadySignals()` in `lib/workflow-eval.js`. That strongly suggests explicit submit remains the canonical meaning of "ready" during migration.

Recommendation:
- `feature-submit` emits `signal.agent_ready` when workflow state exists.
- Failure/reporting paths emit `signal.agent_failed`.
- Optional shell `EXIT` wrapper may emit a non-authoritative "agent process ended" marker or touch a dead-man file, but should not emit `signal.agent_ready`.

### 2. Orchestrator sweep must remain authoritative for `session_lost`

tmux supports hooks such as `session-closed`, `pane-died`, and `pane-exited`, so tmux can provide a fast hint when a session disappears. But tmux hooks are not sufficient as the only source of truth. The orchestrator sweep should remain authoritative for `signal.session_lost`; tmux hooks can be an optimization layer that accelerates detection.

Why:
- tmux hooks only fire while the tmux server and its hook configuration are healthy.
- The dashboard/orchestrator must already sweep to recover from its own crashes and to detect heartbeat expiry.
- A sweep is easier to make idempotent and reason about than a distributed set of hook scripts.

Best design:
- Authoritative path: orchestrator periodically checks expected tmux sessions/panes against workflow snapshots and emits `signal.session_lost` only when the agent is currently `running` or `waiting`.
- Optional fast path: register tmux `session-closed`/`pane-exited` hooks that enqueue a hint file or directly request injection, but still gate final emission through the same dedupe/idempotency rules as the sweep.

### 3. Heartbeat should be a lightweight file touch, not a high-frequency event append

The lightest portable mechanism is a heartbeat file updated by a wrapper/sidecar process, with the orchestrator sweep turning expiry into the durable event `signal.heartbeat_expired`.

Trade-offs:
- File touch:
  - Pros: very cheap I/O, portable across all agent CLIs, survives agent differences, easy to inspect, no event-log bloat.
  - Cons: requires a sidecar or wrapper process and a naming convention.
- Engine event append (`signal.heartbeat` every N seconds):
  - Pros: complete event history.
  - Cons: noisy event logs, more locking/I/O, duplicates become common, little product value compared with storing only last-seen timestamp.
- tmux pane activity:
  - Pros: no agent integration.
  - Cons: not semantic liveness; a model may be alive while not producing pane output, or a pane may show output while the agent is effectively wedged.

Important repo-specific note:
- `lib/workflow-heartbeat.js` currently emits `signal.heartbeat` and sweeps expiry. That is workable, but for production scale I would narrow durable events to meaningful transitions and store frequent heartbeats outside the event log unless the product explicitly needs a full liveness timeline.

### 4. Recommended heartbeat timing: 30s interval, 90-120s expiry

30s heartbeat with 90s default expiry is a good default. It is already what the repo uses (`DEFAULT_HEARTBEAT_INTERVAL_MS = 30000`, `DEFAULT_HEARTBEAT_TIMEOUT_MS = 90000`).

Rationale:
- 30s gives fast enough detection for operator UX.
- 90s tolerates brief pauses, tool calls, and terminal jitter while still surfacing dead sessions quickly.
- 120s is safer if some CLIs or models routinely block for long stretches without shell activity.

Recommendation:
- Keep 30s interval.
- Default expiry to 90s, with config support to raise to 120s for slower environments.
- Sweep every 15-30s; detection latency should be bounded by `min(sweep interval + timeout)`.

### 5. Cross-agent compatibility favors wrapper-based injection over CLI-specific hooks

#### Claude Code

Claude Code has the strongest documented hook lifecycle. Official docs expose `SessionStart`, `PostToolUse`, `Stop`, `SessionEnd`, and many others. Claude-specific hooks are useful for convenience, but Aigon should not depend on them for correctness because Aigon supports multiple agents.

Best use:
- Keep using Claude hooks for project-context/version bootstrap and optional telemetry.
- Do not make engine correctness depend on Claude-only hook semantics.

#### Gemini CLI

The installed Gemini CLI exposes a `hooks` command and `gemini hooks migrate`, which is strong evidence of a first-class hook system. That makes Gemini a plausible candidate for optional lifecycle automation. But from Aigon's perspective, it should still be treated as an optimization, not the only signal path.

Best use:
- Optional auto-bootstrap or telemetry.
- Not the sole source for `agent_ready` or `session_lost`.

#### Codex CLI

I did not find a comparable first-class hook surface in the installed Codex CLI help. The visible surfaces are prompts, config, MCP, feature flags, and app/debug tooling. Aigon's own install architecture for Codex also writes prompts/config, but no hook configuration.

Inference:
- Treat Codex as "no reliable native lifecycle hooks" unless newer official docs add them.
- Use shell wrapper + orchestrator sweep for portability.

#### Mistral Vibe

Aigon's own agent template marks hooks/settings integrations as disabled for `mv`. That is not proof the underlying tool can never support hooks, but it is enough to conclude that Aigon cannot currently rely on a Vibe-specific hook surface.

Inference:
- Treat `mv` as hook-less for architecture purposes.

### 6. Transition strategy: synthesize engine signals from legacy status, do not dual-write forever

During migration, engine-managed features should synthesize `signal.agent_ready` from legacy `agent-status submitted` files, exactly as `lib/workflow-eval.js` already does. That is the cleanest bridge because it preserves one canonical engine read model without forcing every old path to know about every new signal immediately.

Recommendation:
- Engine-managed features:
  - Prefer emitting engine signals directly from `feature-submit`.
  - Continue writing legacy status files temporarily for backward compatibility.
  - On read or pre-eval, synthesize missing engine signals from legacy status when needed.
- Non-engine features:
  - Continue using legacy status/dashboard reads.
- Dashboard:
  - For engine-managed features, read workflow snapshots as canonical.
  - For legacy features, read legacy status files.
  - Avoid mixing both in the same feature card unless the snapshot adapter explicitly labels synthesized state.

This is better than indefinite dual-write because dual-write creates drift and harder debugging. Use synthesis as a bounded migration bridge, then delete it after cutover.

### 7. Reliability and edge cases

#### Dashboard/orchestrator crash

Signals that are direct command-side writes (`feature-submit`, explicit failure) are durable immediately and survive orchestrator crashes. Loss/expiry detection does not happen while the orchestrator is down, so on restart the sweep must reconcile current tmux state and heartbeat timestamps and emit any missing `session_lost` / `heartbeat_expired` events.

#### Duplicate sweeps

The current engine projection is semantically tolerant of duplicate `signal.session_lost` and `signal.heartbeat_expired` events because the agent just remains `lost`. But that is not true idempotency: duplicates still bloat the event log.

Recommendation:
- Injector-side dedupe: before emitting `session_lost` or `heartbeat_expired`, check current projected status and last emitted signal.
- Optional event key: include a dedupe key such as `(agentId, signalType, causalWindow)` if stronger guarantees are needed.

#### Feature-close while heartbeat continues

Once an agent is `ready`, `failed`, `lost`, or dropped, heartbeat emitters should stop. The sweep should also ignore heartbeats for agents not in `running`/`waiting`/`idle`. The current repo already follows that pattern in `sweepExpiredHeartbeats()`.

Recommendation:
- Sidecar/wrapper heartbeat process exits when the agent CLI exits.
- Sweep ignores closed/done features and ignores non-running agents.
- If a late heartbeat arrives after `ready`, do not regress state; update only `lastHeartbeatAt` if needed, or ignore entirely.

### 8. Compensating transactions should be engine-mediated and mostly human-approved

The existing machine already exposes the right recovery primitives: restart, drop, and force-ready, with guards `agentRecoverable` and `agentDroppable`.

Recommended compensations:
- `restart-agent`: default recovery for `lost` or clearly crashed sessions.
- `drop-agent`: allowed when multiple agents remain and the lost/failed one is non-essential.
- `force-agent-ready`: human-only override for cases where the work is known good outside the normal submit path.
- Effect reclaim: if an agent fails while owning a claim, mark affected effects reclaimable and let a fresh worker reclaim them.
- Spec move revert: only for interrupted effect execution, not as an automatic response to ordinary agent failure.

Automation policy:
- Automatic:
  - Detect `session_lost`
  - Detect `heartbeat_expired`
  - Suggest or optionally auto-run `restart-agent` when config explicitly enables auto-recovery
- Human approval required:
  - `force-agent-ready`
  - `drop-agent`
  - Any revert of visible spec state

This keeps the orchestrator deterministic and auditable while avoiding surprising destructive recovery actions.

## Sources

- tmux hooks and notifications: https://raw.githubusercontent.com/tmux/tmux/master/tmux.1
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Claude Code settings reference: https://code.claude.com/docs/en/settings
- Local CLI observation on 2026-03-30:
  - `codex --help` exposes prompts/config/MCP/features/debug, but no hook command
  - `gemini --help` exposes `hooks` and `gemini hooks --help` exposes `gemini hooks migrate`
- Repo evidence:
  - `lib/workflow-eval.js` synthesizes `signal.agent_ready` from legacy manifest status
  - `lib/workflow-heartbeat.js` uses 30s interval / 90s timeout defaults and sweep-based expiry
  - `lib/workflow-core/machine.js` exposes `restart-agent`, `force-agent-ready`, `drop-agent`
  - `lib/worktree.js` launches agents through shell command strings inside tmux, so shell wrappers/sidecars are portable across agents
  - `templates/agents/mv.json` disables hook/settings integration for Mistral Vibe

## Recommendation

Adopt a hybrid architecture with one canonical rule: semantic state changes come from Aigon workflow commands, while liveness loss is inferred by the orchestrator.

Concrete design:
1. `feature-submit` emits `signal.agent_ready`.
2. Explicit failure paths emit `signal.agent_failed`.
3. A shell wrapper/sidecar updates a per-agent heartbeat file every 30s while the agent process is alive.
4. The orchestrator sweep is authoritative for `signal.session_lost` and `signal.heartbeat_expired`, using tmux state plus heartbeat timestamps.
5. tmux hooks (`session-closed`, `pane-exited`) are optional accelerators, not the canonical source.
6. During migration, synthesize missing engine signals from legacy `agent-status` files for engine-managed features; do not rely on permanent dual-write.
7. Recovery actions (`restart-agent`, `drop-agent`, `force-agent-ready`) stay engine-mediated, with only restart optionally automated.

This is the most portable option across Claude, Gemini, Codex, and Vibe, because it does not require any single agent CLI to support lifecycle hooks. It also matches the repo's current trajectory: engine snapshots as the read model, synthesize-on-transition for legacy compatibility, and orchestrator sweep for detection/recovery.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| workflow-signal-injection-command-path | Emit `signal.agent_ready` and `signal.agent_failed` directly from `feature-submit` and explicit failure/reporting paths for engine-managed features. | high | none |
| workflow-heartbeat-sidecar-files | Run a portable shell wrapper/sidecar that maintains per-agent heartbeat timestamps outside the event log. | high | workflow-signal-injection-command-path |
| workflow-orchestrator-loss-sweep | Make the orchestrator sweep the authoritative detector for tmux session loss and heartbeat expiry with deduped signal emission. | high | workflow-heartbeat-sidecar-files |
| workflow-legacy-signal-synthesis | Synthesize missing engine signals from legacy `agent-status` files during the migration window. | high | workflow-signal-injection-command-path |
| workflow-tmux-hook-accelerators | Add optional tmux `session-closed` and `pane-exited` hooks to reduce detection latency without changing the source of truth. | medium | workflow-orchestrator-loss-sweep |
| workflow-recovery-approval-policy | Encode which compensating actions are automatic versus operator-approved in dashboard actions and engine guards. | medium | workflow-orchestrator-loss-sweep |
