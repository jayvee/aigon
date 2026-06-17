---
complexity: very-high
set: agent-session-runtime
depends_on:
  [554]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-16T22:06:53.101Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-session-workflow-signal-bridge

## Summary

Replace the current "tmux shell wrapper runs `aigon agent-status`, and that command directly mutates workflow state" path with a structured bridge from `AgentSession` signals to workflow events. The new rule is: session/host code records agent-session facts, and a dedicated workflow signal bridge decides which facts have entity lifecycle meaning.

This preserves existing user-facing commands and agent prompts, but moves lifecycle semantics out of shell strings and out of `lib/commands/misc.js`. After this feature, tmux code does not know workflow event names such as `signal.agent_ready`, and workflow-core does not know how tmux sessions are named or messaged.

## User Stories

- [ ] As an architect, I can replace the internal session host without rewriting feature/research workflow transitions.
- [ ] As a maintainer, I can test the mapping from `agent_session.task_completed` to `feature.agent_ready` without spawning tmux.
- [ ] As an agent, I can still run `aigon agent-status implementation-complete` from inside a worktree and get the same external behavior.
- [ ] As a dashboard author, I can mark an agent complete by recording a session signal through the same bridge used by CLI and shell wrapper paths.
- [ ] As a future implementer, I can add specialist session types without inventing new workflow states for every specialist.

## Current Behavior To Preserve

Today `lib/worktree.js:buildAgentCommand()` embeds a shell wrapper that:

- emits start statuses such as `implementing`, `reviewing`, `spec-reviewing`, or `addressing-code-review`;
- touches heartbeat files;
- on clean exit runs `aigon agent-status <completion>`;
- on nonzero exit runs `aigon agent-status error`.

`lib/commands/misc.js` handles `agent-status` and directly calls workflow-core helpers such as `recordCodeReviewStarted`, `recordCodeReviewCompleted`, `recordCodeRevisionCompleted`, and `emitSignal(..., 'agent-ready'|'agent-waiting'|'agent-failed')`.

This feature must keep behavior compatible while moving the semantic mapping to a dedicated module.

## Target Design

Session facts:

- `agent_session.started`
- `agent_session.status_reported`
- `agent_session.awaiting_operator`
- `agent_session.task_completed`
- `agent_session.task_failed`
- `agent_session.exited`
- `agent_session.lost`
- `agent_session.operator_message_delivered`
- `agent_session.transcript_bound`

Workflow meanings:

- feature/research lifecycle events already supported by workflow-core.
- review started/completed events already supported by workflow-core.
- existing public signal names such as `agent-ready`, `agent-waiting`, `agent-failed`, and `session-lost`.

Bridge rule: event names belong to the aggregate whose state changes. A session starting is `agent_session.started`. If the feature workflow needs to record that as entity context, the bridge may append an entity-scoped event such as `feature.agent_session_started`, but it must not confuse this with `feature.started`, which means the feature lifecycle moved into implementation.

## Acceptance Criteria

- [ ] New module `lib/agent-sessions/workflow-signal-bridge.js` owns all mapping from session signals/statuses to workflow-core events.
- [ ] `lib/commands/misc.js` no longer directly imports `workflow-core/engine` for `agent-status`. It delegates to `AgentSessionService.recordSessionSignal` or an equivalent application service method.
- [ ] `aigon agent-status <status>` remains a supported compatibility command with the same status names:
  - start/status: `implementing`, `reviewing`, `addressing-code-review`, `addressing-spec-review`, `spec-reviewing`;
  - completion: `implementation-complete`, `revision-complete`, `review-complete`, `spec-review-complete`, `research-complete`;
  - other: `waiting`, `error`, `awaiting-input`;
  - deprecated: `feedback-addressed` remains a no-op warning as today; `submitted` remains rejected as today.
- [ ] The bridge preserves exact current workflow behavior:
  - `reviewing` records code review started.
  - `review-complete --approve` records code review complete with approve verdict and routes through existing transient workflow behavior.
  - `review-complete --request-revision` records code review complete with revision-request verdict.
  - `revision-complete` records code revision complete and emits the existing ready signal.
  - `implementation-complete` emits the existing feature ready signal.
  - `research-complete` emits the existing research ready signal.
  - `spec-review-complete` preserves existing spec review/revision completion behavior.
  - `waiting` and `error` preserve the existing `agent-waiting` and `agent-failed` behavior.
  - `awaiting-input` preserves the existing prompt/status write behavior without advancing workflow.
- [ ] Shell wrapper code in `buildAgentCommand()` stops embedding workflow-oriented semantics. It may call a compatibility reporter, but that reporter must record session signals first and let the bridge map them.
- [ ] The wrapper no longer needs to know workflow event names. It may still know session role, task type, exit code, and the legacy status string required for compatibility.
- [ ] Session signals are persisted in a session-owned append-only record before bridge dispatch. Minimum viable path: `.aigon/sessions/events.jsonl` with `{ id, at, sessionId, entity, role, agent, eventType, status?, payload? }`. If F515 JSON/IO helpers exist, use them for safe append/locking where applicable.
- [ ] Duplicate shell-trap signals are idempotent. Re-running the same completion for the same session/status should not double-advance workflow.
- [ ] Dashboard mark-complete and reopen-agent paths use the same bridge rather than calling workflow-core directly.
- [ ] `docs/architecture.md` documents the new rule: AgentSession emits session facts; WorkflowSignalBridge maps selected facts to entity workflow events.

## Validation

```bash
node -c lib/agent-sessions/workflow-signal-bridge.js
node -c lib/commands/misc.js
node -c lib/worktree.js
npm test
```

Add focused tests for:

- each legacy `agent-status` status mapping.
- review-complete requiring `--approve` or `--request-revision`.
- no workflow transition for `agent_session.started` by default.
- clean exit compatibility behavior if the wrapper still produces a completion signal.
- idempotency for duplicate completion signals.
- dashboard mark-complete using the same bridge path.
- session event persistence before workflow dispatch.

Add at least one integration-style test that simulates:

1. feature started;
2. session started for role `do`;
3. session task completed;
4. workflow snapshot reports the same ready state as the old `agent-status implementation-complete` path.

## Technical Approach

Implement the bridge as a pure mapping layer plus a small dispatcher:

```js
function mapSessionSignalToWorkflowActions(signal, context) {
  return [
    { type: 'workflow.emitSignal', entity, signal: 'agent-ready', payload },
  ];
}

async function dispatchSessionSignal(signal, deps) {
  await deps.sessionStore.appendEvent(signal);
  const actions = mapSessionSignalToWorkflowActions(signal, deps);
  for (const action of actions) await applyWorkflowAction(action, deps);
}
```

Keep the current behavior table close to the code. Do not bury status mapping in shell string construction.

`aigon agent-status` should become a compatibility adapter:

1. resolve entity, agent, role, and main repo using current logic;
2. validate legacy flags and evidence requirements exactly as today;
3. create a normalized `AgentSessionSignal`;
4. call the bridge;
5. write/read agent-status sidecar data only through a small helper or through the service.

Do not try to remove the `agent-status` command in this feature. Installed templates and existing agents still know that command. The architectural improvement is that `agent-status` no longer owns workflow semantics.

For shell wrapper compatibility, prefer this behavior:

- start of wrapper -> session signal `agent_session.status_reported` with legacy status.
- clean exit -> session signal `agent_session.task_completed` with `{ legacyStatus, exitCode: 0 }`.
- nonzero exit -> session signal `agent_session.task_failed` with `{ exitCode, paneTail }`.

If removing automatic clean-exit completion is too risky, preserve it for now but keep the policy in the bridge and document it as compatibility behavior. A future hardening feature can require explicit agent completion signals only.

## Dependencies

- depends_on: agent-session-tmux-host-and-legacy-facade

## Out of Scope

- Adding new workflow states.
- Renaming user-facing `aigon agent-status`.
- Changing installed slash-command templates.
- Requiring the dashboard server to be running for session signals.
- Replacing tmux.
- Enforcing explicit-only completion by removing clean-exit completion. That is a behavior change and should be a later feature if desired.

## Risks

- This is a write-path-contract change. Missing one status mapping can silently break autonomous flows.
- The current `agent-status` handler performs validation, evidence checks, security scans, and sidecar writes as well as workflow updates. Preserve those checks; only move the workflow mapping boundary.
- Idempotency matters because shell traps, dashboard clicks, and manual commands can race or repeat.
- There are direct dashboard route calls into workflow-core today. If they are not routed through the bridge, the architecture remains split-brained.

## Open Questions

- Should session events live in one repo-wide `.aigon/sessions/events.jsonl` or per-session files? Default: one repo-wide file for easier chronological debugging, with `sessionId` in every record.
- Should the bridge append entity-scoped "agent session started" workflow events for observability? Default: no lifecycle transition; only add such events if dashboard/read-model needs a durable correlation.
- Should clean shell exit continue to imply task completion? Default: preserve behavior in this feature; reconsider later with a separate migration.

## Related

- Set: agent-session-runtime
- Prior features in set: agent-session-domain-model-and-service, agent-session-tmux-host-and-legacy-facade
- Research: workflow engine signal architecture discusses `signal.session_lost` and orchestrator-driven signals
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 555" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-555" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-555)"/><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#519</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify actions js split</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#555</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">agent session workflow si…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
