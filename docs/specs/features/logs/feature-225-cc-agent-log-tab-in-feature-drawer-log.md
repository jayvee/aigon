# Implementation Log: Feature 225 - agent-log-tab-in-feature-drawer
Agent: cc

## Summary

Added a seventh **Agent Log** tab to the dashboard feature drawer between
Stats and Control. The tab fetches each agent's `feature-{id}-*-log.md`
markdown via the existing `/api/detail/feature/:id` endpoint and renders
it through the same `marked.parse()` pipeline that the Spec tab uses.

## Approach

### Backend (`lib/dashboard-status-collector.js`)
- New helper `collectAgentLogs(logsDirs, featureId)` scans each logs
  directory, parses filenames matching `^feature-(\d+)-(.+)-log\.md$`,
  and keys entries by:
  - 2-letter agent code when the rest of the filename starts with
    `[a-z]{2}` followed by `-` (Fleet / drive-worktree)
  - `"solo"` otherwise
- Truncates content over `AGENT_LOG_MAX_BYTES` (256 KB) with a
  `… (log truncated — view full file at <path>)` footer.
- Exported alongside `AGENT_LOG_MAX_BYTES` so the test can reference the
  same constant.

### Backend wiring (`lib/dashboard-server.js:buildDetailPayload`)
- For `type === 'feature'` only, computes the candidate logs dirs
  (main repo + any agent worktree paths from `agentFiles[*].worktreePath`)
  and calls `collectAgentLogs`. Result is attached to the response as
  `agentLogs`. Research details remain unchanged.

### Frontend (`templates/dashboard/index.html`, `js/detail-tabs.js`)
- New `<button class="drawer-tab" data-tab="log">Agent Log</button>` in
  `#drawer-tabs`, positioned between Stats and Control.
- `'log'` added to `TAB_ORDER`.
- `renderLog(payload)` handles three cases:
  - Empty `agentLogs` → `drawer-empty` "No agent log written yet." message
    (also covers older aigon servers that don't return the field — AC14)
  - Single agent → renders the markdown directly with `marked.parse`
  - Multiple agents → renders an inline picker (`.log-picker-btn`s) and
    re-renders the body on click without re-fetching the detail payload.
- The picker selection is held in `state.logSelectedAgent` and reset
  whenever the drawer resets.

### Test (`tests/integration/agent-log-collector.test.js`)
- Five cases: solo keying, Fleet keying, 256 KB truncation footer,
  unknown feature id, and missing dir handling.
- Wired into `npm test` so it runs alongside the other integration suites.
- Includes a `// REGRESSION:` comment naming the specific bug each test
  prevents (per CLAUDE.md rule T2).

## Decisions

- **Helper lives in `dashboard-status-collector.js`, not `dashboard-server.js`** —
  the spec asked for it there and the file already groups read-side helpers.
  Kept side-effect-free so tests can pass arbitrary temp dirs.
- **Both padded and unpadded ids accepted** — filenames in this repo use
  2-digit zero-padding (`feature-07-…`) while raw ids in URLs are unpadded
  (`feature-225-…`). The helper compares by `Number(id)` to avoid ambiguity.
- **No new CSS file** — reused existing `.drawer-empty`, `.markdown-body`,
  and `.mono` classes per the spec's "no divergent UX" rule. Added two
  small inline-styled hooks (`.log-picker`, `.log-picker-btn`,
  `.log-body`, `.log-path`) to keep the diff small; the tab inherits the
  drawer's existing typography.
- **Worktree logs scanned via `agentFiles[*].worktreePath`** — mirrors
  what the existing `logExcerpts` collector already does for the Agents
  tab, so the same agent file metadata drives both code paths.
- **Empty agentLogs returns `{}` (not `null`)** — keeps the frontend's
  `Object.keys(...)` happy without a defensive nullish check, and matches
  the shape of `agentFiles` / `logExcerpts`.
- **Picker re-renders without refetching** — `state.payload` is held in
  closure, so switching agents is instant and doesn't hit the network.

## Validation

- `node -c` for `aigon-cli.js`, `lib/dashboard-server.js`, and
  `lib/dashboard-status-collector.js` — clean.
- `npm test` — all 4 integration suites pass (lifecycle 13/13,
  agent-prompt-resolver 11/11, **agent-log-collector 5/5**, landing 1/1).
- `MOCK_DELAY=fast npm run test:ui` — 8/8 dashboard E2E tests pass.
- `bash scripts/check-test-budget.sh` — 1719 / 2000 LOC (still well
  under the 2000 ceiling; this feature added ~95 LOC of test).

## Manual Testing Checklist

1. **AC1 / AC12** — open the dashboard, click any feature card, confirm
   the drawer shows the new **Agent Log** tab between **Stats** and
   **Control**, and that the existing six tabs still render unchanged.
2. **AC5** — pick a solo / drive-worktree feature with at least one
   committed log file (e.g. feature 224). Click **Agent Log**. Verify
   the markdown renders, no picker is shown, and the on-disk path
   appears in mono above the body.
3. **AC4** — pick a Fleet feature with multiple agent logs. Click
   **Agent Log**. Verify a row of agent buttons (`CC`, `GG`, …) appears
   above the body and that clicking each one swaps the markdown
   instantly without a network call (check DevTools Network panel).
4. **AC6** — pick a feature in inbox/backlog with no log file yet.
   Click **Agent Log**. Verify "No agent log written yet." renders
   instead of an error or stack trace.
5. **AC10** — (optional) drop a > 256 KB markdown file into
   `docs/specs/features/logs/` for an existing feature, reload the
   drawer, and verify the body ends with the truncation footer pointing
   to the on-disk path.
6. **AC13** — open features in each lifecycle stage (inbox, backlog,
   in-progress, in-evaluation, done) and verify the **Agent Log** tab
   button is visible in every stage.
7. **AC14** — (regression) verify older `/api/detail` payloads (without
   `agentLogs`) still render the empty state instead of throwing.

## Files changed
- `lib/dashboard-status-collector.js` — new `collectAgentLogs` helper + export
- `lib/dashboard-server.js` — wires the helper into `buildDetailPayload`
- `templates/dashboard/index.html` — new tab button
- `templates/dashboard/js/detail-tabs.js` — `renderLog` + dispatch + reset
- `tests/integration/agent-log-collector.test.js` — new unit test
- `package.json` — adds the new test to `npm test`

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-06

### Findings
- Fleet features dropped agents from `payload.agentLogs` when that agent had not written a log yet, so the Agent Log picker could not show the required empty state for partially-written implementations.

### Fixes Applied
- `4bc7ef8c` — `fix(review): preserve missing fleet agent logs in detail payload`

### Notes
- Review was otherwise targeted and left the rendering approach, API shape, and test wiring intact.
