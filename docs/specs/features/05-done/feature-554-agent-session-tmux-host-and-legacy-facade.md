---
complexity: high
set: agent-session-runtime
depends_on:
  [553]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-16T22:06:52.842Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-session-tmux-host-and-legacy-facade

## Summary

Move Aigon's tmux-specific session mechanics behind the `AgentSessionService` introduced by `agent-session-domain-model-and-service`, while preserving every existing CLI and dashboard behavior. After this feature, `lib/worktree.js` may still expose compatibility functions such as `createDetachedTmuxSession`, but those functions should delegate to `lib/agent-sessions/hosts/tmux.js` instead of owning the domain. Tmux becomes a `SessionHost`, not the agent runtime domain itself.

This is the concrete decomposition that separates "Aigon is managing an agent session" from "the current host implementation is tmux".

## User Stories

- [ ] As a maintainer debugging session creation, I can read `lib/agent-sessions/hosts/tmux.js` for tmux details and `lib/agent-sessions/service.js` for Aigon domain behavior.
- [ ] As a user, `aigon session-list`, `aigon nudge`, dashboard attach/snapshot, and `aigon sessions-close` behave the same as before.
- [ ] As a future implementer replacing tmux with another host, I can implement `SessionHost` without changing workflow-core or dashboard route code.
- [ ] As an agent implementing this feature, I can migrate one call site at a time because `lib/worktree.js` keeps backwards-compatible exports.

## Acceptance Criteria

- [ ] New tmux host implementation exists under `lib/agent-sessions/hosts/tmux.js`.
- [ ] The tmux host implements a documented `SessionHost` contract:
  - `startSession(request)` -> normalized `AgentSession`.
  - `stopSession(sessionRef, options?)`.
  - `stopEntitySessions(entityRef, options?)`.
  - `isSessionAlive(sessionRef)`.
  - `getConsoleSnapshot(sessionRef, options?)`.
  - `deliverOperatorMessage(sessionRef, message, options?)`.
  - `openConsole(sessionRef, options?)` or equivalent attach command builder.
- [ ] New helper modules are added as needed:
  - `lib/agent-sessions/names.js` for Aigon session naming and parsing.
  - `lib/agent-sessions/console.js` for console snapshot/result DTOs.
  - `lib/agent-sessions/hosts/index.js` if a small host registry is useful.
- [ ] `parseTmuxSessionName` and `VALID_TMUX_ROLES` move to `lib/agent-sessions/names.js` or are re-exported from there. `lib/worktree.js` keeps compatibility exports so old imports continue to work.
- [ ] `createDetachedTmuxSession` in `lib/worktree.js` becomes a thin compatibility wrapper around `AgentSessionService.startSession` with the tmux host.
- [ ] Sidecar writes still land in `.aigon/sessions/{sessionName}.json` and include all existing fields consumed by F351/F357:
  - `tmuxId`.
  - `shellPid`.
  - `category`.
  - `entityType`.
  - `entityId`.
  - `role`.
  - `agent`.
  - `agentSessionId`.
  - `agentSessionPath`.
- [ ] Internal tmux routing continues to prefer durable `tmuxId` targets (`-t $N`) over session-name parsing when available.
- [ ] `lib/nudge.js` routes message delivery through `AgentSessionService.deliverOperatorMessage` or through the tmux host behind that service. It should no longer contain low-level paste-buffer orchestration except in compatibility code that is clearly temporary.
- [ ] `aigon session-list` gets its data from `AgentSessionService.listSessions`, preserving output columns and JSON shape if any.
- [ ] Dashboard session endpoints use the service for session lookup and console snapshots. HTTP route files should not parse tmux session names directly after this feature.
- [ ] No workflow events are changed in this feature. The shell wrapper may still call `aigon agent-status` exactly as before until the signal-bridge feature lands.
- [ ] `docs/architecture.md` and `AGENTS.md` module map are updated to describe `lib/agent-sessions/` and the remaining compatibility role of `lib/worktree.js`.

## Validation

```bash
node -c lib/agent-sessions/hosts/tmux.js
node -c lib/agent-sessions/names.js
node -c lib/worktree.js
node -c lib/nudge.js
npm test
```

Add focused tests for:

- tmux session name round-trip parsing for all current roles: `do`, `eval`, `review`, `revise`, `spec-review`, `spec-revise`, `spec-check`, `close`, `auto`.
- legacy sidecar read/write compatibility.
- `createDetachedTmuxSession` compatibility wrapper calls the service with the expected request shape.
- `deliverOperatorMessage` uses `tmuxId` when present and falls back to name only for old sidecars.
- `session-list` output from existing fixture sidecars is unchanged.

Manual smoke after implementation:

```bash
aigon session-list
aigon nudge <feature-id> <agent> "status check"
aigon sessions-close <feature-id>
```

Use a disposable feature or a test repo for manual tmux smoke. Do not run this against active user work unless explicitly intended.

## Technical Approach

Start by copying behavior, not redesigning it. The risk is in hidden behavior embedded in `worktree.js`, so the migration should be mechanical and test-backed.

Recommended order:

1. Move naming/parsing constants first.
2. Add `TmuxSessionHost` with no call-site migration.
3. Teach `AgentSessionService` to use that host in production.
4. Change `createDetachedTmuxSession` to delegate while keeping its signature.
5. Move `nudge` and dashboard/session read paths to the service.
6. Leave `buildAgentCommand` in `lib/worktree.js` for now. That wrapper is addressed by the signal-bridge feature.

`SessionHost.startSession(request)` should accept a fully prepared command, cwd, environment, display name inputs, and session metadata. It should not build provider-specific agent commands. Provider launch composition remains in the existing launch helpers (`lib/agent-launch.js`, `lib/agent-prompt-resolver.js`, `buildAgentCommand`) until a later feature proves a better boundary.

Use `AgentSessionService` as the only module that knows both store and host. The tmux host should not import workflow-core, dashboard routes, or command modules.

## Dependencies

- depends_on: agent-session-domain-model-and-service

## Out of Scope

- Replacing tmux.
- Changing shell trap lifecycle semantics.
- Changing workflow-core events.
- Adding new dashboard UI.
- Changing provider transcript capture beyond preserving existing sidecar fields.
- Deleting `lib/worktree.js`; it remains a compatibility facade and still owns worktree creation for now.

## Risks

- Tmux behavior is user-visible and easy to regress. Preserve command strings, session naming, and target selection carefully.
- `worktree.js` currently mixes worktree creation, launch command composition, terminal adapters, and tmux. This feature should extract only tmux session hosting, not perform a broad cleanup.
- Dashboard and CLI may rely on exact sidecar shape. Add regression fixtures before changing writes.

## Open Questions

- Should `session-list` expose the normalized `sessionId` in addition to current session name? Default: no user-facing output change in this feature.
- Should repo-level sessions become first-class `AgentSession` records with `category: 'repo'` even when they have no entity? Default: yes, normalize them, but do not add new repo-session behavior.

## Related

- Set: agent-session-runtime
- Prior features in set: agent-session-domain-model-and-service
- Architecture-simplify relation: complements F518 by giving dashboard actions a session boundary to call.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 554" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-554" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-554)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-554)"/><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#517</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify unified entity v…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#519</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify actions js split</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#554</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">agent session tmux host a…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
