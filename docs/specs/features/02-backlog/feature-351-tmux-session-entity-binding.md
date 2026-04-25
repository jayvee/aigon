---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T02:43:56.907Z", actor: "cli/feature-prioritise" }
---

# Feature: tmux-session-entity-binding

## Summary

Replace Aigon's name-convention-based tmux session tracking with durable binding via the tmux internal session ID (`$N`). Today, the link between a running tmux session and a feature/research entity is encoded entirely in the session name (e.g. `aigon-f332-do-cc-...`), which must be parsed to route commands and detect liveness. This feature stores the tmux session ID at creation time in entity state and in a global index, so that all internal logic addresses sessions by stable ID — not by name. Session names become human-readable labels only.

## User Stories

- [ ] As a user, I can run `aigon session list` and see all active sessions with their linked entity (feature/research ID, role, agent) without Aigon having to parse session names.
- [ ] As a user, if a tmux session is renamed (or the name is truncated by the terminal), Aigon still correctly identifies it as belonging to feature 332.
- [ ] As a user, sessions that no longer exist in `tmux ls` are automatically detected as dead and pruned from the index.
- [ ] As a developer, all internal session routing (send-keys, attach, liveness check) uses `$N` tmux session ID, not the name string.

## Acceptance Criteria

- [ ] On session creation, `tmux display-message -p '#{session_id}'` is called immediately after `new-session` and the resulting `$N` ID is stored in both entity snapshot and `.aigon/sessions/index.json`.
- [ ] `index.json` maps `tmuxId → { entityType, entityId, role, agent, sessionName, worktreePath, createdAt }`.
- [ ] Entity snapshot (`workflows/{features,research}/{id}/snapshot.json`) gains a `sessions` array containing `{ tmuxId, role, agent, createdAt }`.
- [ ] All internal `tmux send-keys`, `tmux attach`, and liveness-check calls use `$N` ID (via `-t $N`) instead of session name.
- [ ] `aigon session list` (new sub-command) prints a table: entity | role | agent | tmux name | tmux ID | status (alive/dead).
- [ ] Dead sessions (ID absent from `tmux ls`) are pruned from index on next read (lazy reconciliation — no daemon needed).
- [ ] Existing sessions created before this feature (name-only) continue to work via a fallback: if no tmuxId is stored, fall back to name-based lookup and log a deprecation warning.

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Pre-authorised

- May add a `sessions` array field to existing snapshot.json files written during tests.
- May skip `npm run test:ui` if this feature touches only `lib/` and no dashboard assets.

## Technical Approach

**Session creation flow:**
1. After `tmux new-session -d -s <name>`, immediately call `tmux display-message -t <name> -p '#{session_id}'` to get `$N`.
2. Write `$N` + metadata to `.aigon/sessions/index.json` (with file lock).
3. Append `{ tmuxId, role, agent, createdAt }` to `sessions[]` in the entity's `snapshot.json`.

**Index file:** `.aigon/sessions/index.json` — a flat JSON object keyed by tmuxId. Small enough to load entirely; reconcile with `tmux ls -F '#{session_id}'` on every read. Dead entries removed lazily.

**Addressing:** Create a helper `resolveTmuxTarget(tmuxId, fallbackName)` in `lib/tmux.js` that returns `-t $N` if the ID is live, else `-t <name>` with a warning.

**Liveness:** `tmux ls -F '#{session_id}'` gives the full set of live IDs in one call. Compare against index to find dead entries.

**Complexity rationale:** medium — touches session creation paths, adds a new index file and write contract, new `session list` sub-command, but no XState or dashboard changes required.

## Dependencies

- None

## Out of Scope

- Dashboard UI surface for session list (sessions tab, live session panel)
- Process ID (PID) tracking — tmux session ID is sufficient and more stable
- Automatic session cleanup / GC daemon
- Multi-machine session sync

## Open Questions

- Should `snapshot.json` retain a `sessions` array long-term, or should the index be the single source of truth and snapshots only carry the current active session? (Recommendation: keep both; index is the fast lookup, snapshot is the audit trail.)

## Related

- Research: none
- Set: none
