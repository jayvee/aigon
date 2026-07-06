---
complexity: high
set: git-branch-storage
depends_on: [610]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-05T13:12:21.121Z", actor: "cli/feature-prioritise" }
---

# Feature: git-branch-observability

## Summary
Make the `git-branch` backend visible and trustworthy: `aigon storage status` / `doctor` / `report` and the dashboard must report the new backend truthfully, and the dashboard server must keep lease/board state fresh across machines by background-fetching the configured state branch on an interval. This is what turns the CAS lease guarantee into day-to-day *confidence*: user A's board shows "F42 — held by B on machine-y" within a minute of B claiming it, on every machine, without anyone running a manual sync. All additions are read-only from the dashboard's perspective, per the dashboard-read-only rule.

## User Stories
- [ ] As a user, `aigon storage status` shows backend `git-branch`, the configured branch name and remote, offline state, last sync, and ahead/behind counts against the remote tracking ref.
- [ ] As a user looking at any machine's dashboard, I see who holds each active spec (user + machine + agent + expiry) with at most ~a minute of staleness, without running any CLI command.
- [ ] As a user, `aigon storage doctor` tells me when the state branch is unreachable, diverged, has duplicate event ids, or has a lease file that contradicts the audit events — with `--fix` limited to safe, local-projection repairs.
- [ ] As a user running `aigon board --storage`, I see active leases across my configured repos including the holder's user identity.

## Acceptance Criteria
- [ ] `aigon storage status` reports for `git-branch`: backend, remote, branch, offline flag, last sync time/result, ahead/behind of the remote branch, and health — same layout as git-ref's output today, no dropped fields.
- [ ] `aigon storage doctor [--fix]` covers: branch reachability, orphan-ness (warns if the state branch shares history with the default branch), duplicate event ids per spec file, projection drift between branch events and `.aigon/workflows/**`, **stats projection drift** (`stats.recorded` vs local `stats.json`, same checks as git-ref doctor today), lease-file-vs-audit-events consistency, and stale expired lease files (safe to report; `--fix` may clear only *expired* leases via the CAS path).
- [ ] `aigon storage report [--json]` and `aigon board --storage` include git-branch repos with active leases showing `user`, `holderId`, `agentId`, `role`, `expiresAt`.
- [ ] `lib/dashboard-storage.js` DTOs expose backend `git-branch`, branch name, and per-spec active leases including the new `user` field; feature/research rows and detail panels render holder as "user @ machine (agent)" with expiry. The frontend consumes DTOs only — no raw file/branch reads in `templates/dashboard/index.html`.
- [ ] Dashboard server runs a background poller (pattern-matched to existing pollers like `budget-poller.js`): default every **45 s**, overridable via `storage.git.pollIntervalSec` in `.aigon/config.json` (clamp 15–120). It fetches `refs/heads/<branch>` from the configured remote for the active repo, rebuilds lease and event projections if the tip moved, and pushes nothing. Poller is a no-op for `local` backend and while offline; failures degrade to "stale since <time>" badges, never errors in the UI. Optionally also fetch when the dashboard WebSocket client reconnects (cheap freshness win).
- [ ] Staleness is honest: the dashboard shows when lease data was last refreshed from the remote, so "no lease shown" is never mistaken for "definitely unclaimed" on a stale board.
- [ ] Poller and DTO changes never mutate engine state, kill sessions, or acquire/release leases — read-only, display-only (consistent with heartbeat/idle display-only precedents).
- [ ] After any `templates/dashboard/index.html` change, MCP `browser_snapshot` evidence of the lease display states (unclaimed, held-by-me, held-by-other, stale) is captured per CONTRIBUTING.md; `Skill(frontend-design)` consulted before visual changes.
- [ ] `npm run test:core` passes; `npm run test:browser:smoke` passes for the dashboard changes; integration tests cover status/doctor/report output for a git-branch repo fixture.

## Validation
```bash
node -c aigon-cli.js
npm run test:related -- tests/integration lib/spec-store lib/dashboard-storage.js lib/commands/storage.js
npm run test:browser:smoke
```

## Technical Approach
- Extend `lib/spec-store/doctor.js`, `report.js`, `sync-state.js` consumption, and `lib/commands/storage.js` with git-branch cases; keep output shapes shared with (still-present) git-ref until the removal feature lands, so both render through one code path where practical.
- `lib/dashboard-storage.js` remains the DTO boundary; add `user` to the lease DTO and thread it from lease file reads (git-branch) or derived events (local).
- Poller: server-side interval fetch using the same plumbing as `sync()`'s fetch phase but with push disabled; guard with a lock so poller and CLI sync don't interleave fetches; debounce projection rebuilds to tip changes.
- Frontend: render lease badges on pipeline cards per `docs/card-design-wireframe.html` vocabulary; keep it a small, unambiguous holder chip + expiry tooltip, no new interaction surfaces.

## Dependencies
- depends_on: git-branch-cas-leases

## Out of Scope
- Any dashboard-initiated mutation (claim/release/takeover buttons) — CLI only.
- Real-time push channels (SSE/WebSocket/gossip); polling only.
- Cross-repo portfolio redesign — only extend the existing `--storage` views.
- git-ref removal (next feature); this feature may leave shared git-ref/git-branch rendering paths in place.

## Open Questions
- None — poll default locked at 45 s pending measured fetch cost during implementation; tab-reconnect fetch is recommended if trivial.

## Related
- Research: —
- Set: git-branch-storage
- Prior features in set: git-branch-backend-core, git-branch-cas-leases
- Prior art: F596 (dashboard storage status + lease visibility), `lib/dashboard-storage.js`, `docs/card-design-wireframe.html`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="132" viewBox="0 0 1168 132" role="img" aria-label="Feature dependency graph for feature 611" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-611" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-611)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-611)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-611)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#609</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch backend core</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#610</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch cas leases</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#611</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch observability</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#613</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch convert and gi…</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
