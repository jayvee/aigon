---
complexity: medium
---

# Feature: record-agent-session-ids

## Summary

aigon writes a sidecar JSON per tmux session at `.aigon/sessions/<sessionName>.json` (`lib/worktree.js:1158 writeSessionSidecarRecord`) capturing `tmuxId`, `shellPid`, `agent`, `role`, `entityId` etc. — but **not** the agent's own session identifier. So when a tmux session dies (Ghostty pkilled, machine reboot, OOM, accidental `tmux kill-session`), there's no deterministic way to map back to the Claude / Gemini / Codex transcript that was running inside it.

Today the recovery path is mtime-correlation by hand: look at `~/.claude/projects/<repo-slug>/<UUID>.jsonl` files sorted by mtime, guess which one matches the dead tmux session's start time and worktree, hope you're right. Aigon's own telemetry already does this lookup (`lib/telemetry.js:144,428,730` — Claude UUID JSONL, Gemini `~/.gemini/tmp/`, Codex `~/.codex/sessions/`) for stats purposes, but the result is never persisted back into the session sidecar.

This feature captures and persists each agent's native session id into the sidecar, enabling: (1) deterministic resume after tmux death (`aigon feature-do --resume <ID>` → `claude --resume <UUID>`), (2) durable cross-reference between aigon entity and agent transcript for telemetry/log-replay, (3) a "view agent transcript" affordance from the dashboard that maps row → JSONL.

## User Stories

- [ ] As a user whose tmux session died (terminal crash, reboot, accidental kill), I can run `aigon feature-do --resume <ID>` (or `aigon research-eval --resume <ID>`) and aigon resumes the **same Claude/Gemini/Codex conversation** with full context, not a fresh session.
- [ ] As a user inspecting an old completed feature, I can `aigon feature-transcript <ID> [--agent cc]` and aigon prints (or opens) the agent's session transcript path.
- [ ] As a maintainer reading telemetry, the per-session aigon record carries the agent UUID so I can correlate aigon events ↔ agent transcripts without mtime-guessing.
- [ ] As a dashboard user, when I see a session card I can click "Open transcript" to jump to the agent's session log.

## Acceptance Criteria

- [ ] `.aigon/sessions/<name>.json` schema gains an `agentSessionId` field (single string) and `agentSessionPath` field (absolute path to the agent's transcript file). Both populated for the supported agents (cc, gg, cx); null/absent for agents that don't expose a discoverable session.
- [ ] Capture is **post-launch**, by tailing the agent's session-storage directory and binding the most-recently-created entry whose `cwd` matches the worktree path. Reuses existing telemetry lookup helpers (`lib/telemetry.js`) — no duplicated parser logic.
- [ ] Capture is **idempotent** and **non-blocking**. The sidecar is written initially without `agentSessionId` (existing behaviour); a follow-up update happens when the agent's session file appears (within the first ~10s after launch). Failure to discover within the window leaves the field absent — no error, no hang.
- [ ] **Race-free binding**: if two parallel agent launches happen in the same repo (Fleet mode), each binds to the right transcript by matching cwd to the per-agent worktree path, **not** repo root.
- [ ] `aigon feature-do --resume <ID> [--agent cc]` (and `research-eval --resume`, `research-do --resume`) reads `agentSessionId` from the matching sidecar and passes the agent's resume flag (`claude --resume <id>`, `gemini --resume <id>`, `codex resume <id>`). If no sidecar or no `agentSessionId` is found, exit non-zero citing the repair (no silent fallback to fresh session).
- [ ] **Live tmux still wins**: if a tmux session matching the requested `<ID>+<agent>` is still alive, `--resume` reattaches that tmux session and does **not** start a new agent process — the existing in-tmux agent is the source of truth. Resume-by-UUID is reserved for the case where tmux is gone.
- [ ] Capture works for `feature-do`, `research-do`, `feature-eval`, `research-eval`, `feature-spec-review`, `feature-code-review`, `feature-code-revise`, `feature-spec-revise`, `feedback-triage` — every command that spawns an agent inside a tmux session via `lib/worktree.js`/`lib/agent-launch.js`. Exhaustive coverage; not just `feature-do`.
- [ ] Agent coverage: `cc` (Claude), `cx` (Codex), `gg` (Gemini). For `cu` (Cursor) and `op` (OpenCode) — capture if a discoverable id exists; otherwise document the gap and ship without (no blocking).
- [ ] **Backwards-compat**: existing sidecars without `agentSessionId` continue to work (read paths treat the field as optional). No migration of historical sidecars required.
- [ ] **Test**: `tests/integration/agent-session-id-capture.test.js` constructs a temp repo, fakes a `~/.claude/projects/<slug>/<uuid>.jsonl` entry with cwd matching a worktree path, invokes the capture helper, asserts the sidecar gets `agentSessionId: <uuid>`. Same for cx and gg fakes.
- [ ] **Test**: `tests/integration/feature-do-resume.test.js` constructs a sidecar with `agentSessionId`, invokes the resume code path, asserts the spawned command includes `--resume <uuid>`.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.
- [ ] `node -c aigon-cli.js` passes; `aigon server restart` after `lib/*.js` edits.

## Validation

```bash
node -c aigon-cli.js
node tests/integration/agent-session-id-capture.test.js
node tests/integration/feature-do-resume.test.js
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +120 LOC for the two new integration tests (each needs a temp-dir fixture with stub session-storage layouts).
- May skip `npm run test:ui` — backend-only feature.

## Technical Approach

### Code references — current state

- **Sidecar writer**: `lib/worktree.js:1158 writeSessionSidecarRecord(meta)` — writes `.aigon/sessions/<name>.json`. Schema today: `category`, `sessionName`, `repoPath`, `worktreePath`, `createdAt`, `agent`, `tmuxId`, `shellPid`, `entityType`, `entityId`, `role`. **Not** the agent's own UUID.
- **Tmux create**: `lib/worktree.js:1190 createDetachedTmuxSession(sessionName, cwd, command, meta)` — calls the writer right after spawning the tmux server. This is the natural anchor for "capture started here, look for agent transcript with `cwd === worktreePath` and mtime > startedAt."
- **Telemetry lookup paths** (already implemented):
  - Claude: `lib/telemetry.js:144` — scans `~/.claude/projects/<escaped-path>/*.jsonl` for the project.
  - Gemini: `lib/telemetry.js:428,440` — scans `~/.gemini/tmp/<slug-or-hash>/chats/`, matches by `.project_root` file content.
  - Codex: `lib/telemetry.js:730` — scans `~/.codex/sessions/` recursively for `.jsonl` files where `session_meta.cwd` matches the worktree.
- **Agent launch**: `lib/agent-launch.js buildAgentLaunchInvocation()` — composes the CLI command. The `--resume <id>` flag is per-agent: `claude --resume <uuid>` (per `claude --help`), `codex resume <id>`, `gemini --resume <id>` (verify during impl).
- **Existing resume affordance**: claude has `--resume [value]` and `--from-pr`; aigon doesn't currently pass either.

### Capture mechanism — chosen path

**Post-launch discovery, not pre-allocation.** Per `claude --help` there is no `--session-id <uuid>` flag (only `--resume` to load an existing one). So we cannot tell Claude "use this UUID at start". Pre-allocation across all agents would require upstream changes; not in scope.

Capture flow:

1. `createDetachedTmuxSession()` writes the sidecar **without** `agentSessionId` — same as today. Records the launch timestamp `createdAt`.
2. After the tmux session is created, schedule a one-shot async task (no blocking the caller) that polls for ~10s:
   - For agent `cc`: scan `~/.claude/projects/<escaped(repoPath)>/*.jsonl`, sort by mtime desc, pick the first entry whose mtime > `createdAt - 1s` and whose first-line `cwd` field equals `meta.worktreePath`. The filename without `.jsonl` is the UUID.
   - For agent `cx`: scan `~/.codex/sessions/**/*.jsonl`, parse `session_meta.cwd`, match.
   - For agent `gg`: scan `~/.gemini/tmp/*/.project_root`, match content to `worktreePath`. UUID = directory slug.
3. On match, **rewrite** the sidecar with `agentSessionId` and `agentSessionPath` populated. Use a small file-lock (or an atomic rename) so a concurrent reader doesn't see torn JSON.
4. On no-match within window: leave fields absent. Log a debug line. No error to caller — many sessions don't need resume.

Reuse `lib/telemetry.js` lookup helpers — they already implement the cwd-matching logic. Refactor any private cwd-matchers into exported helpers so this feature and telemetry share one implementation; do **not** duplicate.

### Resume mechanism

New ctx command (or option on existing entity commands):
- `aigon feature-do <ID> --resume [--agent <id>]`
- `aigon research-do <ID> --resume [--agent <id>]`
- `aigon feature-eval <ID> --resume`
- `aigon research-eval <ID> --resume`

Resolution order:
1. If a tmux session matching `<ID>+<agent>` is alive → reattach it (no resume needed; agent is in tmux).
2. Else, look up the most recent sidecar for `<ID>+<agent>` with `agentSessionId` populated.
3. If found → spawn the agent CLI with `--resume <agentSessionId>` in a fresh tmux session, write a new sidecar that **back-references** the previous sidecar via `resumedFrom: <previousSessionName>` so chains stay traceable.
4. If not found → exit non-zero, cite manual recovery (`tmux ls`; `claude --resume` interactive picker).

### Out-of-scope for this feature, explicitly

- **Pre-allocating UUIDs at launch.** Requires upstream agent CLI flags. Future work.
- **Migrating historical sidecars.** Read paths tolerate the missing field; no backfill.
- **Cross-machine resume sync.** `lib/sync.js` already syncs `.aigon/`; it'll carry the new fields automatically. Cross-machine resume of `~/.claude/projects/<UUID>.jsonl` is a separate concern.
- **Cursor (`cu`) and OpenCode (`op`) coverage.** Investigate during impl; ship without if no discoverable id exists. Document the gap.

### Files to edit

1. `lib/worktree.js`
   - Extend `writeSessionSidecarRecord` to accept optional `agentSessionId`/`agentSessionPath`.
   - Add `updateSessionSidecar(sessionName, repoPath, patch)` for post-launch capture rewrite (or land it in a new `lib/session-sidecar.js` if the file's getting unwieldy).
   - In `createDetachedTmuxSession` (or its caller in `agent-launch.js`), kick off the post-launch capture task.
2. `lib/telemetry.js`
   - Export the cwd-matching helpers (Claude/Gemini/Codex) so the new capture code consumes them. No new parser logic.
3. `lib/agent-launch.js`
   - Plumb `--resume <agentSessionId>` into `buildAgentLaunchInvocation` per agent (each agent's resume flag is different; codify in the existing per-agent flag table).
4. `lib/commands/feature.js` / `lib/commands/research.js` / `lib/commands/entity-commands.js`
   - Wire `--resume` flag through `feature-do`, `feature-eval`, `research-do`, `research-eval`. Use the entity-commands shared factory where possible.
5. `tests/integration/agent-session-id-capture.test.js` (new) — temp-repo fixture per agent.
6. `tests/integration/feature-do-resume.test.js` (new) — assert resume path passes `--resume <uuid>`.
7. `AGENTS.md` — short paragraph in the State Architecture section noting that sidecars now carry `agentSessionId` and that resume reads from it.

## Dependencies

- None. All upstream agent CLIs already support resume by id; aigon already parses each agent's session storage in `lib/telemetry.js`. This is purely a producer-side capture + a consumer-side flag.

## Out of Scope

- Pre-allocated session UUIDs at agent launch (requires upstream agent CLI flags).
- Backfill of historical sidecars (read paths treat the field as optional).
- Cross-machine resume coordination beyond what `lib/sync.js` already does.
- Cursor (`cu`) / OpenCode (`op`) capture if no discoverable id exists — document the gap, don't block.
- Dashboard UI for "Open transcript" — separate dashboard feature once the data is there.
- Consolidating multiple resumes into a single conversation chain (handled today by `claude --resume` semantics; aigon just records the new sidecar with `resumedFrom`).

## Open Questions

- Which agent CLIs accept `--resume <id>` non-interactively as of today? Claude does (`-r, --resume [value]`). Codex has `resume` subcommand with `--last`. Gemini — verify during impl. If any require interactive picker, that agent's resume path will need an extra step (e.g. `expect`-style scripted answer) or remain manual; document either way.
- Do agents that emit OSC 9/777 ever expose the session UUID via escape sequence? If so, we could capture deterministically at the moment the agent prints its first prompt rather than mtime-polling. Worth investigating in impl; not blocking.
- Should `.aigon/sessions/<name>.json` get rewritten on every change (today: written once on tmux create, deleted on session death) or should agentSessionId capture be a separate `<name>.agent.json` sidecar? Current lean: one file, atomic rewrite. Decide during impl.

## Related

- Set: standalone
- Closely related to `lib/telemetry.js` cross-agent normalization (already does the lookup work; this feature consumes it).
- Closely related to memory: "Codex MCP tool approval config" — both are operator-facing reliability features around long-lived agent sessions.
- Pairs with potential follow-up: dashboard "Open transcript" affordance keyed off `agentSessionPath`.
