# Feature: track feature-session relationship via metadata not naming

## Summary

Currently, tmux sessions are linked to features/research entirely through session name parsing (e.g. `aigon-f007-do-cc`). This means orphan detection, session enumeration, and dashboard display all depend on fragile regex matching. When names are malformed, truncated, or ambiguous, sessions become invisible or miscategorised. This feature introduces a small metadata sidecar file written at session creation time so the session→entity relationship is stored explicitly, and name parsing becomes a fallback rather than the source of truth.

## User Stories

- [ ] As a user, I can kill orphaned sessions from the dashboard even when the session names don't match expected patterns
- [ ] As a user, the Sessions tab accurately reflects the repo/feature/agent for every session, without depending on session name conventions
- [ ] As a user, orphan detection works correctly after a feature is closed, regardless of how the session was named

## Acceptance Criteria

- [ ] When a tmux session is created via `buildAgentCommand` / `createDetachedTmuxSession`, a sidecar file `.aigon/sessions/{sessionName}.json` is written containing: `sessionName`, `entityType` (f/r), `entityId`, `agent`, `role`, `repoPath`, `worktreePath`, `createdAt`
- [ ] `getEnrichedSessions()` reads sidecar files first; falls back to `parseTmuxSessionName()` for sessions without a sidecar (backward compat)
- [ ] Orphan detection (`classifyOrphanReason`) uses sidecar `entityId`/`entityType` directly instead of relying on parsed name
- [ ] Stale sidecar files (session no longer in `tmux list-sessions`) are ignored and cleaned up on next `getEnrichedSessions()` call
- [ ] Existing sessions without sidecar files continue to work via name-parsing fallback
- [ ] `npm test` passes

## Validation

```bash
node -c lib/worktree.js
npm test
```

## Technical Approach

**Sidecar file location:** `.aigon/sessions/{sessionName}.json` (gitignored, per-repo)

**Written at:** session creation in `createDetachedTmuxSession()` (and the higher-level wrappers that call it). Pass entity context as an optional `meta` param — callers that don't provide it get no sidecar (safe).

**Read at:** `getEnrichedSessions()` — scan `.aigon/sessions/*.json`, build a lookup map keyed by session name. For each live tmux session, check the map first; fall back to `parseTmuxSessionName()` if no sidecar exists.

**Cleanup:** When enriching sessions, collect sidecar filenames that have no corresponding live session and delete them (or mark stale). Keep it lightweight — no separate GC process.

**Sidecar schema:**
```json
{
  "sessionName": "aigon-f007-do-cc",
  "entityType": "f",
  "entityId": "7",
  "agent": "cc",
  "role": "do",
  "repoPath": "/Users/jviner/src/aigon",
  "worktreePath": "/Users/jviner/.aigon/worktrees/aigon/feature-007-cc",
  "createdAt": "2026-04-09T01:00:00.000Z"
}
```

**No changes to session naming** — names stay the same so existing tooling (tmux, terminal window titles, `sessions-close`) continues to work. The sidecar augments but doesn't replace the name.

**`lib/agent-status.js` is not changed** — that file tracks submission/review lifecycle, not session identity. These are separate concerns.

## Dependencies

- None

## Out of Scope

- Changing tmux session naming conventions
- Migrating existing sessions retroactively (fallback covers them)
- Centralising session metadata across repos (each repo owns its own `.aigon/sessions/`)
- Replacing `lib/agent-status.js` session tracking

## Open Questions

- Should `worktreePath` be included in the sidecar, or is it already available from `agent-status`? (Include it — avoids a second lookup in the dashboard)

## Related

- Research: none
