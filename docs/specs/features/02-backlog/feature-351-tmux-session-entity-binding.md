---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T02:43:56.907Z", actor: "cli/feature-prioritise" }
---

# Feature: tmux-session-entity-binding

## Summary

Replace Aigon's name-convention-based tmux session tracking with durable binding via the tmux internal session ID. Today, the link between a running tmux session and a feature/research entity is encoded entirely in the session name (e.g. `aigon-f332-do-cc-...`), which must be parsed to route commands and detect liveness. This feature records the tmux session ID and shell PID at creation time in both a per-session sidecar file and the entity's own snapshot, creating a two-way reference. Session names become human-readable labels only. A new session category model also captures repo-scoped sessions (the "Ask agent" flow) which are currently invisible to Aigon's session system.

## Background: tmux session IDs

tmux assigns every session a short internal ID at creation time: `$1`, `$2`, `$12`, etc. — a sequential integer prefixed with `$`. The `$` is tmux's way of indicating "this is a session ID, not a name or index" in its target syntax (windows use `@N`, panes use `%N`). The ID is stable for the lifetime of the session regardless of what processes run inside it or whether the session is renamed. It resets when the tmux server restarts, but by then all sessions are gone anyway. You capture it immediately after session creation:

```bash
tmux new-session -d -s "aigon-f332-do-cc-..."
tmux display-message -t "aigon-f332-do-cc-..." -p '#{session_id}'
# → $12
```

Once stored, all internal routing uses `-t $12` rather than `-t aigon-f332-do-cc-...`.

## Sidecar structure

"Sidecar" refers to the per-session JSON file Aigon writes to `.aigon/sessions/{sessionName}.json` alongside the rest of its state. Today it contains:

```json
{
  "sessionName": "aigon-f332-do-cc-implementation-log-format",
  "entityType": "f",
  "entityId": "332",
  "agent": "cc",
  "role": "do",
  "repoPath": "/Users/jviner/src/aigon",
  "worktreePath": "/Users/jviner/.aigon/worktrees/aigon/feature-332-cc-...",
  "createdAt": "2026-04-24T00:01:46.228Z"
}
```

Proposed structure adds `category`, `tmuxId`, and `shellPid`:

```json
{
  "category": "entity",
  "tmuxId": "$12",
  "shellPid": 48291,
  "sessionName": "aigon-f332-do-cc-implementation-log-format",
  "entityType": "f",
  "entityId": "332",
  "agent": "cc",
  "role": "do",
  "repoPath": "/Users/jviner/src/aigon",
  "worktreePath": "/Users/jviner/.aigon/worktrees/aigon/feature-332-cc-...",
  "createdAt": "2026-04-24T00:01:46.228Z"
}
```

`tmuxId` is the durable foreign key used to address the session and join with entity state. `shellPid` (from `#{pane_pid}`) is supplementary — useful for fast liveness checks (`kill -0 $PID`) without invoking tmux, and for signal-based operations. It is not the FK because a new shell can spawn inside the same session, changing the PID while the session continues.

## Session categories

Not all tmux sessions Aigon creates are entity-bound. The category field distinguishes them:

| category | example session name | association |
|---|---|---|
| `entity` | `aigon-f332-do-cc-...` | feature/research ID + role + agent |
| `repo` | `ask-aigon-cc` | repo path + agent only — no entity |

`repo` sessions are created by the "Ask agent" button and the "New Feature → Refine with agent" flow in the dashboard. Both call `/api/session/ask`, produce a session named `ask-{repoName}-{agentId}`, and currently write no sidecar at all — they are invisible to `aigon session list`. This feature adds sidecar writing for them with `category: "repo"` and no `entityType`/`entityId`.

## Two-way reference

The tmuxId creates a foreign-key relationship in both directions:

```
Entity snapshot  workflows/features/332/snapshot.json
  sessions: [{ tmuxId: "$12", role: "do", agent: "cc", createdAt: "..." }]
                        │
                        │  $12 is the join key
                        ▼
Sidecar  .aigon/sessions/aigon-f332-do-cc-....json
  { tmuxId: "$12", entityType: "f", entityId: "332", ... }
```

- **Entity → session**: given feature 332, find its sessions by reading `sessions[]` in snapshot, then look up each `$N` in live tmux output.
- **Session → entity**: given a sidecar, read `entityId` to find the feature. No name parsing required in either direction.

## Code simplifications from this feature

The name-based approach requires defensive parsing and validation that the ID approach eliminates entirely:

**`loadSessionSidecarIndex` (~30 lines of guards removed):** Currently validates that the sidecar's `sessionName` matches the filename stem, that the stem appears in the live-session-names set, and that entityType is one of `f/r/S`. With IDs: read `tmuxId` from the file, check if it appears in `tmux ls -F '#{session_id}'` output. The stem-matching guard and name-set comparison disappear.

**`pruneStaleSessionSidecars`:** Currently iterates filenames, strips `.json`, checks against a `Set<string>` of live session names. With IDs: reads each file's `tmuxId`, checks against a `Set<string>` of live session IDs. Same structure, but the live-set is populated from one `tmux ls -F '#{session_id}'` call rather than a separate `tmux ls` name parse.

**`tmuxSessionExists`:** Currently calls `tmux has-session -t <name>` — one subprocess per check. Any code that needs to check multiple sessions can now do one `tmux ls -F '#{session_id}'` call and use set membership, eliminating N subprocesses.

**Session routing:** Any call site that reconstructs a session name from entity data to send keys or attach can be replaced with a direct `$N` lookup from the sidecar. Name reconstruction logic is deleted.

**Tests:** Test cases that assert on session-name parsing edge cases (truncation, collision detection, name reconstruction) are deleted. Liveness mocking simplifies from per-session `has-session` stubs to a single `tmux ls` stub returning an ID list.

Estimated net: ~30–40 lines of name-parsing/validation removed, ~15 lines of new `resolveTmuxTarget` helper, ~10 lines for repo-category sidecar writing. The code that remains is structurally simpler with no edge cases around name format.

## User Stories

- [ ] As a user, I can run `aigon session list` and see all active sessions — both entity-bound and repo-level ask sessions — with their association, tmux ID, and alive/dead status.
- [ ] As a user, if a tmux session is renamed or its name is truncated by the terminal, Aigon still routes commands to it correctly via its `$N` ID.
- [ ] As a user, sessions that no longer exist in `tmux ls` are automatically detected as dead and pruned on next read — no manual cleanup needed.
- [ ] As a developer, all internal session routing uses `$N` tmux session ID, not the session name string.

## Acceptance Criteria

- [ ] After `tmux new-session`, Aigon immediately calls `tmux display-message -p '#{session_id}'` and `#{pane_pid}` to capture `tmuxId` and `shellPid`.
- [ ] Both values are written to the sidecar alongside all existing fields plus a `category` field (`entity` or `repo`).
- [ ] Entity snapshots (`workflows/{features,research}/{id}/snapshot.json`) gain a `sessions` array: `[{ tmuxId, role, agent, createdAt }]`. `tmuxId` is the FK linking snapshot to sidecar.
- [ ] `repo`-category sessions (`ask-{repoName}-{agentId}`) now produce a sidecar with `category: "repo"`, `repoPath`, `agentId`, `tmuxId`, `shellPid` — no `entityType`/`entityId`.
- [ ] All internal `tmux send-keys`, `tmux attach`, and liveness-check calls use `-t $N` rather than the session name.
- [ ] `tmux ls -F '#{session_id}'` replaces per-session `tmux has-session` calls for bulk liveness checks.
- [ ] `aigon session list` prints a table: category | entity | role | agent | session name | tmux ID | status.
- [ ] Stale sidecars (tmuxId absent from `tmux ls`) are pruned lazily on next read.
- [ ] Existing name-only sidecars (no `tmuxId`) fall back to name-based routing with a deprecation warning logged.

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Pre-authorised

- May add `sessions` array to snapshot.json files written during tests.
- May skip `npm run test:ui` if this feature touches only `lib/` and no dashboard assets.

## Technical Approach

**Session creation (in `createDetachedTmuxSession`):**
1. Create session as today.
2. Immediately run `tmux display-message -t <name> -p '#{session_id} #{pane_pid}'` — two format tokens in one call.
3. Parse `$12` and `48291` from the output.
4. Pass both into `writeSessionSidecarRecord` alongside existing metadata and `category`.
5. For entity sessions: append `{ tmuxId, role, agent, createdAt }` to `sessions[]` in the entity snapshot.

**Routing helper — `resolveTmuxTarget(tmuxId, fallbackName)` in `lib/worktree.js`:**
Returns `-t $N` if `tmuxId` is in the current live-ID set, else `-t <name>` with a warning. All `send-keys` / `attach` call sites use this helper.

**Liveness — single `tmux ls` call:**
`tmux ls -F '#{session_id}'` returns one ID per line. Parse into a `Set`. Use for all bulk checks in `loadSessionSidecarIndex` and `pruneStaleSessionSidecars`. Replace the existing `Set<sessionName>` with `Set<tmuxId>` throughout.

**Repo-category sidecars:**
In the `/api/session/ask` route handler, after `createDetachedTmuxSession`, call `writeSessionSidecarRecord` with `category: "repo"`, `repoPath`, `agentId`. Remove the `entityType` guard that currently blocks this.

## Dependencies

- None

## Out of Scope

- Dashboard UI surface for session list
- Automatic session GC daemon
- Multi-machine session sync
- `infra`-category sessions (dashboard server is not currently tmux-hosted)

## Open Questions

- None — design is settled.

## Related

- Research: none
- Set: none
- Enables: feature-aigon-state-sync (suspended-session detection relies on `sessions[]` in snapshot)
