---
complexity: medium
set: dash-arch
depends_on: [620]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:18.951Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-2-fs-watch-collection

## Summary

Make server-side status collection event-driven instead of purely interval-driven. Today `lib/dashboard-server.js` re-collects all repos on a fixed timer (`POLL_INTERVAL_ACTIVE_MS = 20s`, idle 60s), so a change written to disk by an agent or the CLI (spec moved by the engine, agent status file updated in a worktree, workflow snapshot advanced) waits up to 20–60s before the server even *knows* about it — and then up to another client poll interval before the browser shows it. This feature adds per-repo debounced filesystem watchers on the Aigon state surfaces, triggering the existing targeted `pollRepoStatus(repoPath)` within ~500ms of a change. The interval poll is demoted to a safety net (it still covers tmux liveness and watcher misses).

Combined with dash-arch-1 (versioning) and dash-arch-3 (SSE push), this closes the end-to-end "change on disk → visible in browser" latency from a worst case of ~30–80s to ~1–2s.

## User Stories

- [ ] As a user running `aigon feature-prioritise 42` in a terminal, the card moves to Backlog on my open dashboard within a couple of seconds, not half a minute.
- [ ] As a user watching a Fleet run, agent status changes (implementing → waiting → ready) written to `.aigon` state show up near-instantly after the agent writes them.
- [ ] As a user with 6 registered repos, the dashboard server is not doing full 6-repo collections every 20s when nothing is changing — CPU and log noise go down, not up.

## Acceptance Criteria

- [ ] A watcher module (e.g. `lib/dashboard-fs-watch.js`) sets up watchers per registered repo covering: the repo's `.aigon/` state directories that feed the status collector (workflow snapshots, agent status, autonomous plan state — derive the exact list from what `collectDashboardStatusData`/`dashboard-status-collector.js` reads), and the spec trees that the collector indexes (`docs/specs/features/**`, `docs/specs/research-topics/**`, `docs/specs/feedback/**` stage folders).
- [ ] Worktree agent-status paths: identify where per-agent status files that the collector reads actually live (primary repo `.aigon` vs worktree checkouts) and watch whichever locations the collector reads. If worktree paths are impractical to watch (created/destroyed dynamically), document that in code and rely on the safety-net poll for those — but state-in-primary-repo must be watched.
- [ ] Events are debounced/coalesced per repo (~300–500ms trailing) into a single `pollRepoStatus(repoPath)` call; a burst of file writes (e.g. `feature-start` creating worktrees) triggers one collection, not dozens.
- [ ] Collections triggered by watchers reuse the existing `pollRepoStatus` path so F590 perf logging, notification side effects (`afterPollSideEffects`), and dash-arch-1 version bumps all fire exactly as they do for interval polls.
- [ ] The full interval poll remains as a fallback (single interval, e.g. 60s regardless of active/idle) because tmux session liveness, pane-derived signals, and failed/unsupported watchers do not produce reliable file events. The active/idle 20s/60s split can be removed.
- [ ] Watcher lifecycle: created at server start for every registered repo, added when a repo is registered (`aigon server add`), torn down on repo deregistration and on server shutdown. No watcher leaks across `aigon server restart`.
- [ ] Robustness: watcher `error` events are caught and logged, never crash the daemon; a failed watcher for one repo degrades that repo to interval-poll behaviour and logs once (not per-poll). Editor noise (`.swp`, `~`, `.tmp`, `.DS_Store`) is filtered before scheduling a collection.
- [ ] Platform: use `fs.watch` with `recursive: true` on darwin; on Linux (no recursive support on older Node/kernels) fall back to watching the known fixed-depth stage/state directories individually. No new npm dependency (no chokidar) unless the hand-rolled fallback proves genuinely insufficient — if you do add one, justify it in the feature log.
- [ ] A config escape hatch (`dashboard.fsWatch: false` in project `.aigon/config.json`, with the same key accepted from the global config if dashboard settings already merge global defaults) disables watchers and restores pure interval polling. The startup log states whether fs-watch is enabled, disabled by config, or unavailable on the platform.
- [ ] Integration test: start the server against a fixture repo, write/move a spec file, assert `latestStatus` reflects it within ~2s without waiting for an interval poll.

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Keep the watcher layer thin: its ONLY job is `fs event → debounce → pollRepoStatus(repoPath)`. All collection, fingerprinting (dash-arch-1), and notification logic stays where it is. This preserves the write-path contract (AGENTS.md § Write-Path Contract): no new state is produced, only existing read paths are triggered sooner.
- Watch descriptor budget: watching 5–10 directories per repo across ~6 repos is well within macOS/Linux limits; avoid watching `node_modules`, `.git`, or whole worktree checkouts.
- `aigon doctor` awareness is NOT required; a `[fs-watch]` log line at startup listing watched repos (and any that failed) is enough for diagnosis.
- Beware feedback loops: collections must not write into watched paths. Audit `afterPollSideEffects` and notification persistence for writes into `.aigon`; explicitly exclude those files/directories from scheduling, or prove they are outside the watch set in the feature log.
- Restart the dashboard server after `lib/*.js` edits (CLAUDE.md hot rule #3).

## Dependencies

- depends_on: dash-arch-1-status-version-etag

## Out of Scope

- Pushing changes to the browser — dash-arch-3 (until then, watchers still improve worst-case latency because the client polls into a fresher snapshot).
- Watching arbitrary user project files (build outputs, source code). Only Aigon lifecycle state.
- tmux event integration (control-mode subscriptions) — the safety-net poll covers liveness.

## Open Questions

- Exact debounce value: start at 400ms trailing; if `feature-start` bursts still double-collect, add a short leading-suppression window.
- Should `/api/refresh` (manual Refresh button) also become "just poke the watcher path"? No — keep it as an explicit full collection; it's the user's escape hatch.

## Related

- Prior work: F460 (poll intervals), F590 (perf logging), F294/F296 (engine state write paths that define which directories matter).
- Set: dash-arch — wave 1 (server/data plane: 1 → 2 → 3).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 621" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-621" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-621)"/><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-621)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-621)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#620</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 1 status versio…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#621</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 2 fs watch coll…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#622</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 3 sse status pu…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
