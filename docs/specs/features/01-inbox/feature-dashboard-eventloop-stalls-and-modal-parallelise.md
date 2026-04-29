---
complexity: high
planning_context: ~/.claude/plans/crispy-riding-knuth.md
---

# Feature: dashboard-eventloop-stalls-and-modal-parallelise

## Summary

The dashboard exhibits multi-second stalls on routine actions (opening a spec drawer, opening the "Start Autonomously" modal). Root cause is the Node event loop being held synchronously by F446's `quotaMidRun.scanActiveSessions()` (one `tmux capture-pane` per active session, every 10s in `pollStatus`) and by `_rebuildDepGraphAsync`'s ~700 sync `readFileSync` calls in a single tick. Frontend compounds it: the modal does four sequential awaits before showing anything, the dashboard re-renders on every poll regardless of diff, and `spec-drawer.js` carries leftover `console.trace` + a hostile `visibilitychange` auto-close. This feature fixes the producer-side blocking and the frontend chain that piles on top.

## User Stories

- [ ] As John, when I click a spec card, the drawer fills within 200 ms even with 15 active tmux sessions live — I never wait seconds on "Loading…".
- [ ] As John, when I click "Start Autonomously", the modal appears immediately with the agent rows already populated — banner and workflow dropdown can hydrate in the background.
- [ ] As John, when nothing has changed in the status payload, the dashboard does not re-render the kanban tree; my scroll position and any open menus are preserved between 10 s polls.

## Acceptance Criteria

- [ ] p95 `/api/spec` response time < 200 ms with ≥ 15 active tmux sessions running, measured client-side over 30 drawer opens.
- [ ] Server `pollStatus` total wall time < 150 ms p95 under the same load (visible in `logs/server.log`).
- [ ] `_rebuildDepGraphAsync` does not hold the loop > 50 ms in any single tick (verified via `process.hrtime` probe; probe removed before merge).
- [ ] `showAutonomousModal` first paint < 50 ms after click (warm cache); modal interactive (workflow dropdown populated, banner hydrated) < 600 ms.
- [ ] Dashboard `render()` skipped when status fingerprint is unchanged; `updated-text`/title still refresh each poll.
- [ ] `console.trace` in `spec-drawer.js` and the `visibilitychange` auto-close listener are removed.
- [ ] `/api/settings` is no longer fetched by `showAutonomousModal`; default model strings come from `window.__AIGON_AGENTS__`.
- [ ] All existing tests green; new dedup-skip test added asserting `tmux capture-pane` is NOT invoked when `tmux list-sessions` activity epoch is unchanged for a session.

## Validation

```bash
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

Seven file-scoped changes, ordered. Plan detail in `~/.claude/plans/crispy-riding-knuth.md`.

1. **`lib/quota-mid-run-detector.js` — activity-gated, async, yielding scan.** In `scanActiveSessions` (line 165), before the per-sidecar loop run one `tmux list-sessions -F '#{session_name} #{session_activity}'` (existing `runTmux` helper). Build `Map<sessionName, activityEpoch>`. Keep a module-level `lastActivityByName: Map<string, number>` cache. For each sidecar: if the current epoch matches the cached epoch, `continue` (skip both `tmuxSessionExists` and `capture-pane`). Update the cache after a successful classify. Convert the function to `async`. After every 4 sidecars that DID need a `capture-pane`, `await new Promise(r => setImmediate(r))` so the loop drains. Keep `persistQuotaPause` + `emittedDedupe` semantics unchanged — F446's existing tests must pass without modification.

2. **`lib/dashboard-server.js:1832`** — `pollStatus` becomes `async`; `await quotaMidRun.scanActiveSessions(repoPath)`. The `setInterval` already tolerates async callbacks. Existing failure handler stays.

3. **`lib/feature-dependencies.js` + `lib/dashboard-server.js:197` — chunked dep-graph rebuild.** Add new exported `buildDependencyGraphAsync(paths, utils, featureIndex, { chunkSize = 25 } = {})`. The outer folder loop becomes `for await`; after every `chunkSize` files do `await new Promise(r => setImmediate(r))`. `_rebuildDepGraphAsync` becomes `async`, awaits the new builder, writes cache on completion. Keep the sync `buildDependencyGraph` exported (used by `tests/integration/feature-dependencies.test.js` and CLI).

4. **`templates/dashboard/js/spec-drawer.js`** — delete `console.trace('openDrawer called:', ...)` (line 114). Delete the entire `visibilitychange` listener block (lines 273-279).

5. **`templates/dashboard/js/init.js`** — gate `render()` on a status fingerprint. New `function statusFingerprint(data)` hashes: `summary.{waiting,inProgress,inEval}`, each repo's `(features.length, research.length, feedback.length)`, and per-feature `(id, stage, currentSpecState, agents.map(a => a.id+":"+a.status+":"+(a.idleLadder?.state||'')))`. Stash on `state.lastFingerprint`. In `poll()` (line 439), only call `render()` when the fingerprint differs. Move the `updated-text`/title refresh OUT of the gated branch — timestamp updates each poll regardless. Settings-view path keeps using `settingsNeedsRerender`. **Critical:** the fingerprint must include `idleLadder.state` so the auto-nudge ladder updates visibly.

6. **`lib/agent-registry.js:597`** — extend `getDashboardAgents(opts = {})` to accept `{ globalConfig, projectConfig }`. For each agent, resolve `defaultImplementModel`, `defaultResearchModel`, `defaultEvaluateModel`, `defaultReviewModel` using the same project → global → `DEFAULT_GLOBAL_CONFIG` precedence as `buildDashboardSettingsPayload` (`lib/dashboard-server.js:843-937`). Reuse `getConfigModelValue` helper from `dashboard-server.js`. Update the call site at `lib/dashboard-server.js:951` to pass `{ globalConfig, projectConfig }`.

7. **`templates/dashboard/js/actions.js:1686` — parallelise `showAutonomousModal`:**
   - Read defaults synchronously from `AIGON_AGENTS[i].defaultImplementModel`. Build skeleton rows immediately.
   - `modal.style.display = 'flex'` BEFORE any awaits.
   - `Promise.all([fetchSpecRecommendation(...), populateAutonomousWorkflowDropdown(repoPath)])`; hydrate banner + dropdown as each resolves.
   - Replace `await fetchBudget(true)` with `fetchBudget(false)` (cache hit). Kick a background `fetchBudget(true)` only if cached value is > 5 min stale; `updateAutonomousBudgetNotice()` after it resolves.
   - Delete the `autonomousModalModels = await fetchAgentModels(...)` line entirely.

### Restart rule

After any `lib/*.js` edit, run `aigon server restart` (CLAUDE.md hot rule).

### Verification path

- `npm run test:iterate` per iteration (auto-runs Playwright since `lib/dashboard*.js` and `templates/dashboard/**` are in scope).
- Pre-push: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.
- Manual MCP browser: open dashboard with ≥10 live sessions in a seed repo; click 10 spec drawers in rapid succession; record `performance.now()` deltas via `mcp__playwright__browser_evaluate`. Open the autonomous modal; first paint < 50 ms.

## Dependencies

-

## Out of Scope

- xterm.js render performance (terminal panel lag, addon version mismatch, ResizeObserver thrash, pty-session-handler flush) — covered by separate feature `xterm-render-lag-fix`.
- Replacing the in-panel terminal with a third-party iframe (ttyd/wetty/etc.) — explicitly rejected; xterm.js stays.
- Removing the SSE fallback path in `terminal.js connectSessionStream` — dead-ish but out of scope here.

## Open Questions

- Should the `lastActivityByName` cache in `quota-mid-run-detector.js` be invalidated when `tmux list-sessions` no longer reports a session (i.e. session ended)? Default: leave stale entries in place and let them age out naturally — entries are only consulted when the sidecar still exists.
- Should the `render()` fingerprint include `feature.lastCloseFailure` so a freshly-failed close re-renders? Lean yes — include it.

## Related

- Research: <!-- N/A -->
- Set: <!-- standalone -->
- Prior features in set: <!-- F446 introduced the synchronous quota scan that this feature de-blocks; not formally a "set" -->
