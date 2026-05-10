---
complexity: high
research: 48
set: apply-model
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T09:02:02.961Z", actor: "cli/feature-prioritise" }
---

# Feature: apply-4-dashboard-upgrade-flow

## Summary

A three-phase coached pill in the dashboard chrome that walks the user from "newer aigon on npm" → "restart server" → "re-apply to N repos" with one observation + one action per phase. The dashboard is the only surface that sees the full upgrade arc — terminals see individual moments. Single-repo by default; multi-repo list/buttons appear automatically when the registry (feature #5) ships. Per-repo diff preview before any apply runs (no silent mutation).

## User Stories

- [ ] As a customer with a newer aigon on npm, I see a slim top-bar pill in my dashboard with the npm command to copy and a "what's in the new version" expander — no modal interrupting my workflow board.
- [ ] As a customer who just ran `npm update -g @senlabsai/aigon`, my dashboard's pill transitions in place to "aigon v2.68 installed. Restart the dashboard to use it." with a one-click `[ Restart now ]` button.
- [ ] As a customer who restarted the dashboard server, the pill transitions to "Re-apply aigon v2.68 to your repos" with a list of stale repos, per-repo `[ Preview ]` and `[ Re-apply ]` buttons, and a `[ Re-apply all N stale repos ]` aggregate button.
- [ ] As a customer mid-apply, I see live progress per repo (queued / applying / applied / failed) streamed via the existing dashboard WebSocket.
- [ ] As a customer where everything is current, the pill is **absent** from the dashboard chrome. No "✓ all good" reassurance row.
- [ ] As a customer who clicks `[ Preview ]` on a stale repo, I see the file diff (paths + count + brief description) of what `aigon apply` would change, before I commit to running it.

## Acceptance Criteria

- [ ] A new `<aigon-status-pill>` component renders in the dashboard chrome (top band, same row as connection status).
- [ ] Pill is hidden when all layers are current (`appliedDigest === installedDigest && dashboardProcess === installedCli && npmLatest <= installedCli` for the current repo).
- [ ] **Phase 1 (npm has newer):** Pill shows `↑ aigon vX.Y available  (you have vX.Z)  [ Show ]`. Expanded view includes copy-paste npm command, changelog highlights, and a "what happens next" preview.
- [ ] **Phase 2 (dashboard server behind):** Pill shows `✓ aigon vX.Y installed. Restart the dashboard to use it.  [ Restart now ]`. Click runs `aigon server restart`; dashboard reconnects via existing WebSocket reconnect logic.
- [ ] **Phase 3 (re-apply needed):** Pill shows `↻ Re-apply aigon vX.Y to your repos.  [ Show repos ▾ ]`. Expanded panel lists current repo + (if registry exists) all known repos, with status, version delta, file change count, and per-row buttons.
- [ ] `[ Preview ]` button shows the diff of what would change in that repo (paths + change-type per file, not full content) before any mutation.
- [ ] `[ Re-apply ]` (single repo) runs `aigon apply` in that repo; live progress streamed.
- [ ] `[ Re-apply all N stale repos ]` runs `aigon apply --all`; per-repo progress streamed; failures are inline and non-blocking (one failure doesn't abort the others).
- [ ] After completion: `✓ All repos applied at vX.Y` flash, auto-fades after 5 seconds, then pill is hidden.
- [ ] No phase auto-advances. Each phase requires explicit user click. Dashboard never closes/restarts itself without explicit action.
- [ ] Pill never appears in the workflow board area — chrome only.
- [ ] Cadence: dashboard heartbeat checks digest + dashboard process every 5s active / 60s inactive. npm check uses existing 5-min cache.
- [ ] When tab is inactive, polling backs off to 60s (existing behavior).

## Validation

```bash
npm run test:browser:smoke
# Visual smoke: with a stale repo, pill renders Phase 3
# In-sync state: pill is absent from DOM (not just hidden — not rendered)
```

After implementation, take an MCP `browser_snapshot` to confirm the a11y tree shows the pill in the right phase per state.

## Pre-authorised

- (default — Playwright still runs at the pre-push gate)

## Technical Approach

**Backend.** New endpoint `GET /api/version-status` returns the read-model from feature #3 (`getRepoVersionStatus()`) plus, when registry exists, per-repo status across all known repos. Dashboard polls this on heartbeat. Endpoint is read-only.

**Action endpoints.**
- `POST /api/server/restart` — runs `aigon server restart` (existing endpoint, possibly already exists as part of dev-server management).
- `POST /api/apply` body `{ repoPath?: string, all?: boolean }` — runs `aigon apply` (single repo, defaults to current) or `aigon apply --all` (registry walk). Streams progress via existing WebSocket event channel.
- `GET /api/apply/preview?repoPath=...` — returns the file-change list (path + change-type, no full content) for what `aigon apply` would do.

**Frontend.** New `<aigon-status-pill>` Lit component in `templates/dashboard/js/components/aigon-status-pill.js`. Subscribes to `version-status` channel. Renders one of: `null` (current), `<phase-1-npm-pill>`, `<phase-2-restart-pill>`, `<phase-3-apply-pill>`. Phase derivation:

```js
if (status.npmLatest > status.installedCli) return 'phase-1';
if (status.dashboardProcess < status.installedCli) return 'phase-2';
if (status.appliedDigest !== status.installedDigest || hasStaleRepos(status)) return 'phase-3';
return null;
```

**Live progress.** Re-use the existing dashboard WebSocket event bus (the same one workflow events use). New event types: `apply.queued`, `apply.started`, `apply.completed`, `apply.failed`, each with `{ repoPath, fromVersion, toVersion, changes? }`.

**Multi-repo behavior.** If registry (feature #5) is present, Phase 3 expanded view lists all known repos. If absent, lists only the current repo. Component code handles both — the registry's existence is data-driven, not a separate component path.

**Restart action.** `[ Restart now ]` runs the same restart procedure that already exists from F296 dashboard-server-restart work. Page reconnects automatically when the server's WebSocket comes back up.

## Dependencies

- depends_on: apply-3-session-drift-notice

## Out of Scope

- Multi-repo machine view as a separate tab. Folded into Phase 3 expanded panel.
- Desktop / OS notifications. Dashboard chrome only.
- Cross-repo notification when dashboard for repo A sees that repo B is stale. The notice comes from B's own dashboard / agent session.
- Auto-applying after restart. Every phase needs explicit user click.

## Open Questions

- Should Phase 3 default to "expand the panel" or stay collapsed? Default: collapsed, user clicks `[ Show repos ▾ ]`. Less intrusive on first paint.
- Diff preview format: just paths + change-type, or include first-N-lines of each diff? Default: paths + change-type only — full diffs belong in `git diff` after the apply runs.

## Related

- Research: #48 aigon-versioning-model-and-multi-repo-update-ux
- Set: apply-model
- Prior features in set: apply-1, apply-2, apply-3
