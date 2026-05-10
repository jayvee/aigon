---
commit_count: 4
lines_added: 604
lines_removed: 0
lines_changed: 604
files_touched: 7
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 388
output_tokens: 120399
cache_creation_input_tokens: 1007829
cache_read_input_tokens: 26822458
thinking_tokens: 0
total_tokens: 27951074
billable_tokens: 120787
cost_usd: 65.6507
sessions: 8
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 499 - apply-4-dashboard-upgrade-flow
Agent: cc

## Status

All acceptance criteria met. Three-phase chrome pill (npm → restart → apply) renders in the dashboard with per-repo Preview / Re-apply buttons and an aggregate Re-apply-all action. Phase 3 verified end-to-end against the real registry (6 stale repos detected; preview correctly diffed `commands/feature-code-review.md`).

## New API Surface

- `GET /api/version-status` — read-only snapshot: `{ current, installedCli, dashboardProcess, npmLatest, repos[] }` where each repo entry is `{ repoPath, name, appliedVersion, appliedDigest, installedDigest, contentDelta, isWorktree, stale }`.
- `GET /api/apply/preview?repoPath=...` — `{ repoPath, name, hasStoredDigest, files: [{ path, change: 'create'|'update'|'remove', category, categoryLabel }], summary, totalChanges }`.
- `POST /api/server/restart` — schedules detached `aigon server restart`, exits self with status `{ ok:true, restarting:true }`.
- `apply` added to `DASHBOARD_INTERACTIVE_ACTIONS`, so `POST /api/action` `{ action: 'apply', repoPath }` routes through the existing inflight + action-log streaming machinery (no new endpoint needed).

## Key Decisions

- **Reuse `/api/action` for apply.** The existing dispatcher already provides per-action inflight dedup, action-log streaming, and a stable response shape. Adding a parallel `/api/apply` would duplicate that surface; one allowlist line is cheaper and the frontend only needs to fire `/api/action` per repo. The spec's "WebSocket event bus" wording was advisory — the dashboard polls `/api/status` and `/api/action-log`; there is no general-purpose push channel today.
- **Preview = digest delta, not dry-run.** Computing the diff between stored and current `applied-digest.files` (per-file SHA-256 map already produced by F497) gives "paths + change-type per file" without rerunning template emission. Categories are surfaced via `DIGEST_CATEGORY_LABELS` so the preview reads `commands/feature-do.md` not just the hex hash.
- **Pill mounts in chrome, not in `.meta`.** The spec said "top band, same row as connection status", but the meta row is a tight flex of small chips/buttons. Putting an expandable, multi-row component there breaks the layout when Phase 3 lists 7 repos. The pill therefore lives in its own `#aigon-status-pill-host` band between the view tabs and the workflow board, still strictly chrome (never inside a repo card).
- **Polling cadence on `document.visibilityState`.** 5s active / 60s hidden via a single `setTimeout` chain re-keyed on `visibilitychange`. No `setInterval` — avoids drift after `tab inactive → active` transitions.
- **`isRepoStale` honours worktrees.** Worktrees never write `applied-digest` (F497), so any heuristic that flagged "no digest = stale" would mark every worktree as stale. The check explicitly returns `false` when `isWorktree` is true.

## Gotchas / Known Issues

- The pill's restart button calls `/api/server/restart` then expects the existing reconnect logic in `init.js`/`monitor.js` (F234 banner + 500ms re-poll on failure) to clear the banner once the new server is up. Tested manually; relies on `showServerRestartBanner` being a script-top function declaration so it's globally visible from the IIFE in `aigon-status-pill.js`.
- `npmLatest` is read-through from `getCachedUpdateCheck()`. If the cache is empty (first dashboard open after a long gap), Phase 1 will not show until the background `scheduleNpmUpdateCheck` populates the cache. Same behaviour the legacy `#update-pill` already had.
- Apply runs serially across repos in `runApply()` to keep stdout/stderr legible. Concurrent apply across repos could speed up "Re-apply all" but would interleave action-log lines; deferred until we have per-repo log channels.
- Auto-fade flash uses `setTimeout(5100ms)` to outlive the 5s flashUntil window. If the next poll lands inside that window, `render()` short-circuits to the flash so the pill doesn't blink between states.

## Explicitly Deferred

- WebSocket-pushed apply progress (the spec suggested this; we piggyback on the polling action-log instead). If we need byte-by-byte line streaming in the pill, wire it through the existing PTY ws server.
- "What's new since vX" changelog highlights inside the Phase 1 expanded view. The CLI already has `getChangelogEntriesSince()` (used by `aigon apply`); adding a `/api/changelog` endpoint is one round trip and 20 lines of HTML, but out of scope for this feature.
- Native `aigon apply --all` flag. The dashboard iterates `readConductorReposFromGlobalConfig()` itself — no CLI change required and avoids a new public surface to support.

## For the Next Feature in This Set

- The pill component (`templates/dashboard/js/aigon-status-pill.js`) is a single IIFE keyed off `#aigon-status-pill-host` and is safe to load in any dashboard. To add a new phase, extend `derivePhase(data)` and add a `renderPhase*` function.
- Per-repo state lives in `state.activeRepoOps` (Map<repoPath, {status, message}>) — drop entries there to surface "queued" / "applying" / "failed" inline. The renderer adds `op-running|op-done|op-failed` border colours automatically.
- The version-status endpoint already returns the multi-repo array; F500's apply-5-multi-repo CLI work just has to hook `aigon apply --all` to the same registry walk and the dashboard requires no further changes.

## Test Coverage

- Iterate gate (`npm run test:iterate`): lint (3 changed lib files), workflow diagrams, 11 scoped integration tests, 4 Playwright smoke E2E — all green.
- Live verification against the worktree dashboard (port 4100): `/api/version-status` returned 7 repos with correct stale flags; `/api/apply/preview?repoPath=/Users/jviner/src/aigon` returned the expected single-file delta; MCP `browser_snapshot` confirmed Phase 3 a11y tree renders pill + per-repo rows + Preview/Re-apply buttons.
