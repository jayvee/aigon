---
complexity: high
set: agent-session-runtime
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-16T22:06:52.564Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-session-domain-model-and-service

## Summary

Introduce `lib/agent-sessions/` as Aigon's explicit runtime domain for long-lived interactive agent work. Today this concept is spread across `lib/worktree.js`, `.aigon/sessions/*.json` sidecars, `lib/session-sidecar.js`, `lib/nudge.js`, dashboard session routes, and the `aigon agent-status` command. This feature creates the domain model, store, and service contract without changing launch behavior yet. The goal is to give Aigon one vocabulary for "an agent session" before tmux and workflow signaling are moved behind that vocabulary.

An `AgentSession` means: a long-lived, interactive agent process context created or tracked by Aigon for one entity, one role, and one agent slot. It may run for minutes or hours, wait for operator input, be reopened, resume a provider transcript, stop cleanly, or become lost. It is not the workflow state. It is not the provider transcript. It is not tmux. Tmux is one possible host for an `AgentSession`.

## User Stories

- [ ] As an Aigon maintainer, I can open `lib/agent-sessions/model.js` and understand exactly what a session is, what state it owns, and how it relates to feature/research workflow state.
- [ ] As an implementing agent, I can use `AgentSessionService` instead of knowing that sessions are currently tmux sessions with sidecar JSON files named after tmux session names.
- [ ] As a dashboard route author, I can ask for live sessions by entity, role, and agent without parsing tmux names or touching workflow-core internals.
- [ ] As a future maintainer adding specialist agents such as `frontend-developer` or `code-review`, I can attach a specialist profile to an `AgentSession` without changing workflow event names or provider agent IDs.

## Glossary

- `AgentSession`: Aigon-owned runtime record for a live or historical agent interaction.
- `AgentSessionService`: public application service used by CLI, dashboard actions, supervisor, nudge, and future Pro integrations.
- `AgentSessionStore`: persistence boundary for `.aigon/sessions/` records and session event records.
- `SessionHost`: replaceable implementation that can start, stop, observe, and interact with an external process host. Tmux is a host, not the domain.
- `SessionConsole`: read/write console surface for a session host. It supports snapshots, attach/open, and operator messages.
- `TranscriptBinding`: link from an Aigon session to provider-native transcript state, e.g. Claude UUID, Codex session path, Gemini session ID.
- `AgentSpecialistProfile`: optional domain object identifying the work persona or skill bundle for the session, e.g. `frontend-developer`, `code-review`, `security-review`. It is separate from the provider agent id (`cc`, `cx`, `gg`, etc.).

## Acceptance Criteria

- [ ] New directory `lib/agent-sessions/` exists with at least:
  - `index.js` public facade.
  - `model.js` domain constants, validators, normalizers, and JSDoc typedefs.
  - `service.js` `AgentSessionService` factory.
  - `store.js` `AgentSessionStore` for `.aigon/sessions/`.
  - `events.js` session event constants and validator helpers.
  - `errors.js` typed errors or error-code helpers.
- [ ] The public facade exports a small, stable API. Minimum operations:
  - `createAgentSessionService(options)`.
  - `normalizeAgentSessionRecord(raw, source)`.
  - `validateAgentSessionStartRequest(request)`.
  - `SESSION_ROLES`, `SESSION_STATES`, `SESSION_CATEGORIES`, `SESSION_EVENT_TYPES`.
- [ ] `AgentSession` records have a documented shape:
  - `sessionId`: stable Aigon session id. For this feature, use the existing sidecar/tmux session name as the id to avoid migration risk.
  - `category`: `entity` or `repo`.
  - `entity`: `{ type: 'feature' | 'research', id: string }` for entity sessions, otherwise `null`.
  - `role`: one of the existing tmux roles: `do`, `eval`, `review`, `revise`, `spec-review`, `spec-revise`, `spec-check`, `close`, `auto`, or `null` for repo sessions.
  - `agent`: `{ id, slotAgentId?, runtimeAgentId? }`.
  - `specialist`: optional `{ id, label?, instructionsRef?, skillRefs? }`.
  - `state`: `requested`, `starting`, `active`, `waiting`, `stopped`, `lost`, or `unknown`.
  - `host`: optional `{ kind, handle }`; for legacy records this may include tmux fields but model code must not require tmux.
  - `paths`: `{ repoPath?, worktreePath?, cwd? }`.
  - `transcriptBinding`: optional `{ provider, providerSessionId?, path?, capturedAt? }`.
  - `createdAt`, `updatedAt`, `startedAt`, `stoppedAt`.
  - `metadata`: optional plain object for future compatibility.
- [ ] `AgentSessionStore` reads existing `.aigon/sessions/{sessionName}.json` sidecars and normalizes them into the model without requiring a migration. The current live sidecar shape is `{ category, sessionName, repoPath, worktreePath, createdAt, agent, tmuxId, shellPid, entityType, entityId, role }`, with optional F351/F357 transcript fields (`agentSessionId`, `agentSessionPath`). The normalizer must:
  - map `sessionName` → `sessionId` (the session name remains the id, per Open Questions default).
  - map `entityType` (`'f'` → `'feature'`, `'r'` → `'research'`) and `entityId` → `entity: { type, id }`; set `entity: null` when `category === 'repo'`.
  - fold `tmuxId`/`shellPid` into `host: { kind: 'tmux', handle: { tmuxId, shellPid } }` while leaving the raw fields accessible.
  - fold `agentSessionId`/`agentSessionPath` into `transcriptBinding` when present.
  - These legacy fields must round-trip: a normalized record written back must still satisfy existing readers.
- [ ] The store writes records in a backwards-compatible JSON shape under `.aigon/sessions/`; existing readers that expect the old fields continue to work.
- [ ] The service can be created with an injected fake `SessionHost` and supports testable operations:
  - `startSession(request)`.
  - `getSession(sessionRef)`.
  - `listSessions(filter)`.
  - `findSession({ entity, role, agentId })`.
  - `recordSessionEvent(event)`.
  - `updateTranscriptBinding(sessionRef, binding)`.
  - `markSessionState(sessionRef, state, patch?)`.
- [ ] In this feature, production launch call sites do not need to move yet. The service may be introduced and covered by tests without changing `createDetachedTmuxSession`.
- [ ] No module in `lib/agent-sessions/` imports `lib/worktree.js`, `lib/dashboard-server.js`, `lib/dashboard-routes/*`, `lib/workflow-core/*`, or `lib/commands/*`. This is a load-bearing acyclic boundary.
- [ ] `docs/architecture.md` gains a short "Agent Sessions" subsection explaining the domain, its owned state, and its relationship to workflow-core.

## Validation

```bash
node -c lib/agent-sessions/index.js
node -c lib/agent-sessions/model.js
node -c lib/agent-sessions/service.js
node -c lib/agent-sessions/store.js
npm test
```

Add focused tests for:

- normalizing a real live sidecar (`{ category, sessionName, entityType, entityId, role, tmuxId, shellPid, ... }`) and asserting `sessionId === sessionName`, `entity.type` maps `'f'`→`'feature'` / `'r'`→`'research'`, and `host.handle` carries `tmuxId`/`shellPid`.
- normalizing a `category: 'repo'` sidecar and asserting `entity === null` and `role === null`.
- normalizing transcript binding fields (`agentSessionId`, `agentSessionPath`) into `transcriptBinding`.
- rejecting invalid roles, invalid entity types, malformed timestamps, and missing ids.
- service behavior with a fake host and temporary `.aigon/sessions/` directory.
- verifying `lib/agent-sessions/` does not import workflow/dashboard/worktree modules.

## Technical Approach

Keep this feature deliberately read-model/service-contract oriented. The implementation should not try to refactor tmux startup in the same pass.

Recommended file layout:

```text
lib/agent-sessions/
  index.js
  model.js
  events.js
  errors.js
  service.js
  store.js
```

`model.js` should contain plain JavaScript constants and normalizers. Avoid classes unless they clearly reduce complexity; this codebase mostly uses functions and objects.

`store.js` should default to the current repo's `.aigon/sessions` path but accept `{ repoPath }` so dashboard collectors can read other repos later. F515 has landed: use `lib/io/json.js` (`readJsonSafe`, `writeJsonAtomic`, `ensureDir`) for all JSON I/O — do not hand-roll `fs.readFileSync`/`JSON.parse` in this module.

`service.js` should accept dependencies:

```js
function createAgentSessionService({
  repoPath = process.cwd(),
  store = createAgentSessionStore({ repoPath }),
  host = null,
  now = () => new Date(),
} = {}) { ... }
```

If `startSession` is called without a host, throw a typed `agent_session_host_unavailable` error. Tests should inject a fake host to prove the contract.

Specialist support is model-only in this feature. Do not create a specialist registry or UI yet. The goal is to reserve a clean place for future `frontend-developer` or `code-review` personas without coupling them to tmux names, workflow states, or provider ids.

## Dependencies

- None required.
- Related but not blocking: `simplify-centralise-paths-and-json-io` should be used if it lands first.

## Out of Scope

- Moving tmux process creation out of `lib/worktree.js`.
- Changing shell wrapper lifecycle behavior.
- Changing workflow-core events or XState states.
- Adding dashboard UI for specialists.
- Changing provider transcript capture logic in `lib/session-sidecar.js`.
- Renaming existing CLI commands.

## Risks

- The word `session` is overloaded. Mitigation: the docs and model must explicitly distinguish `AgentSession`, provider transcript/session state, and host process state.
- Backwards compatibility with `.aigon/sessions/*.json` is load-bearing. Do not introduce a new file naming convention in this feature.
- If the service imports worktree or workflow modules, the dependency boundary fails and future decomposition becomes harder.

## Open Questions

- Should `sessionId` remain the tmux session name forever, or should a future migration add a UUID while preserving `sessionName` as host metadata? Default for this feature: keep current name as `sessionId`.
- Should `AgentSpecialistProfile` later live under `templates/agents/`, a new `templates/specialists/`, or project config? Default: reserve the model field only.

## Related

- Set: agent-session-runtime
- Prior features in set: none
- Architecture discussion: AgentSessionService, tmux host, workflow signal bridge
