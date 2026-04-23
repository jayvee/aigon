---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T01:24:09.882Z", actor: "cli/feature-prioritise" }
---

# Feature: Agent Budget Awareness

## Summary

Poll Claude Code and Codex CLIs every 30 minutes via throwaway tmux sessions to extract remaining budget (session and weekly limits). Cache results in `.aigon/budget-cache.json`. Surface the data as a new **"Agent Budget" tab in the Settings panel** (alongside Repositories, Notifications, Models, Repository Settings) and annotate the agent picker in feature-start and autonomous-start flows so users can make informed agent selection decisions before a budget runs out mid-task.

The polling approach was validated live: spawning a throwaway `claude --dangerously-skip-permissions` session, navigating to the Usage tab of `/status`, and capturing the pane costs zero tokens ($0.00 confirmed). Codex exposes `5h limit` and `Weekly limit` directly in its startup banner — no navigation required.

## User Stories

- [ ] As a user about to start a feature, I can see that Claude Code is 97% through its weekly budget so I pick Codex as the implementation agent instead.
- [ ] As a user, I can open Settings → Agent Budget and see each agent's session % and weekly % remaining, with a manual refresh button.
- [ ] As a user starting an autonomous feature, I see a warning if my primary agent is >80% through either budget limit before the run begins.
- [ ] As a user, budget data refreshes automatically every 30 minutes while the dashboard is running, and I can manually trigger a refresh via a button.

## Acceptance Criteria

- [ ] `lib/budget-poller.js` polls Claude Code and Codex every 30 minutes; results written atomically to `.aigon/budget-cache.json`
- [ ] Claude Code parsing extracts: session % used, session reset time+tz, week-all % used, week-all reset time+tz
- [ ] Codex parsing extracts: 5h limit % remaining + reset time, weekly limit % remaining + reset time+date
- [ ] Cache file includes a `polled_at` ISO timestamp per agent so staleness can be detected
- [ ] `GET /api/budget` returns the cached data (or `null` per agent if never polled or poll failed)
- [ ] Settings panel has an "Agent Budget" tab showing each agent's limits with colour-coded bars: green ≥50% remaining, amber 20–49%, red <20%
- [ ] Agent picker rows for `cc` and `cx` show inline budget annotation, e.g. `cc — 35% session · 3% week ⚠`
- [ ] If a selected agent's primary budget metric is <20% remaining at feature-start time, a non-blocking confirmation warning is shown before proceeding
- [ ] Autonomous-start handler checks budget before firing; warns if selected agent <20% on any limit
- [ ] Poller skips an agent gracefully if the CLI binary is not on PATH; logs a warning, does not crash the dashboard
- [ ] If a previous poll tmux session didn't clean up, it is killed before starting a new one
- [ ] `node -c lib/budget-poller.js` passes; `npm test` passes

## Validation

```bash
node -c lib/budget-poller.js
node -c lib/dashboard-routes.js
npm test
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +30 LOC for budget-poller unit tests.
- May skip `npm run test:ui` when changes touch only `lib/budget-poller.js` and no dashboard HTML or JS assets.

## Technical Approach

### Polling (`lib/budget-poller.js`)

New module started by `dashboard-server.js` alongside the existing memory-log heartbeat. Exports `startBudgetPoller(ctx)` which:

1. Runs immediately on start, then every 30 minutes via `setInterval`
2. For each configured agent (`cc`, `cx`), calls the appropriate `poll<Agent>Budget()` function in sequence
3. Merges results and writes atomically to `.aigon/budget-cache.json` using the same `atomicWriteJSON()` pattern as `lib/agent-status.js:61`

**Claude Code poll sequence:**
```
tmux kill-session -t aigon-budget-cc 2>/dev/null  # clean up any prior crash
tmux new-session -d -s aigon-budget-cc -x 220 -y 50
send: "claude --dangerously-skip-permissions" Enter
sleep 8 (wait for prompt)
send: "/status" Enter
sleep 2
send: Right (navigate to Usage tab)
sleep 1
capture-pane -p → parse
tmux kill-session -t aigon-budget-cc
```

Parse regex targets:
- `(\d+)%\s+used` combined with preceding `Current session` / `Current week` section headers
- `Resets\s+(\S+)\s+\(([^)]+)\)` for reset time and timezone

**Codex poll sequence:**
```
tmux kill-session -t aigon-budget-cx 2>/dev/null
tmux new-session -d -s aigon-budget-cx -x 220 -y 50
send: "codex" Enter
sleep 6 (banner appears on load — no command needed)
capture-pane -p → parse
tmux kill-session -t aigon-budget-cx
```

Parse regex targets:
- `5h limit:\s+\[.*\]\s+(\d+)%\s+left` and `\(resets\s+([^)]+)\)`
- `Weekly limit:\s+\[.*\]\s+(\d+)%\s+left` and `\(resets\s+([^\)]+)\)`

**Cache shape (`.aigon/budget-cache.json`):**
```json
{
  "cc": {
    "polled_at": "2026-04-23T10:30:00.000Z",
    "session":    { "pct_used": 65, "resets_at": "12pm", "tz": "Australia/Melbourne" },
    "week_all":   { "pct_used": 97, "resets_at": "9am",  "tz": "Australia/Melbourne" },
    "week_sonnet": { "pct_used": null }
  },
  "cx": {
    "polled_at": "2026-04-23T10:30:00.000Z",
    "five_hour": { "pct_remaining": 58, "resets_at": "13:47" },
    "weekly":    { "pct_remaining": 49, "resets_at": "07:23", "resets_date": "29 Apr" }
  }
}
```

For Claude Code, `pct_remaining = 100 - pct_used`. The dashboard uses `pct_remaining` for both agents for consistent colouring logic.

### API (`lib/dashboard-routes.js`)

Add two routes to the routes array:

- `GET /api/budget` — reads `.aigon/budget-cache.json` synchronously (small file, pure cache), returns parsed JSON or `{ cc: null, cx: null }` if the file doesn't exist
- `POST /api/budget/refresh` — triggers an immediate out-of-cycle poll asynchronously; returns `{ ok: true }` immediately

### Settings tab (`templates/dashboard/index.html` + `js/settings.js` or inline)

Add "Agent Budget" as a new tab in the existing Settings panel, after "Repository Settings". The tab is only shown if at least one agent has been polled (i.e., cache file exists).

Tab content — two rows, one per agent:

```
Claude Code   session  [████████░░] 35% left   resets 12pm (Melbourne)
              week     [█░░░░░░░░░]  3% left ⚠ resets 9am (Melbourne)
              updated 12 min ago                                      ↻

Codex         5h       [██████████] 58% left   resets 13:47
              weekly   [██████████] 49% left   resets 07:23 on 29 Apr
              updated 8 min ago
```

Colour classes on bar and percentage:
- `budget-green`: ≥50% remaining
- `budget-amber`: 20–49%
- `budget-red`: <20% (also shows ⚠)

If `polled_at` is >90 min old, show "stale" label in grey — no colour coding applied.

The `↻` refresh button fires `POST /api/budget/refresh`, then re-fetches `/api/budget` after 12 seconds and re-renders the tab content. The 12s delay accounts for tmux session spawn + capture time.

If both agents return `null`, show: "No budget data yet — data is collected every 30 minutes while the dashboard is running."

### Agent picker integration (`templates/dashboard/js/actions.js`)

In `renderAgentPickerRows()` (currently around line 880):

1. Fetch `GET /api/budget` once when the picker opens (cheap cache read)
2. For `cc` and `cx` rows, append a budget annotation: `35% session · 3% week ⚠`
3. If worst budget metric is <20%, style the annotation in amber and add ⚠

**Warning before autonomous start:** In the autonomous-start handler, after agent selection, before firing `POST /api/features/{id}/run`:

1. Read cached budget for the selected agent
2. If any limit is <20% remaining: show `confirm()` dialog — `"Claude Code is at 97% of its weekly limit. Start anyway?"`
3. If user cancels, return to picker. If confirms, proceed normally.

Staleness check: if `polled_at` is >90 minutes old, show a grey "stale" label instead of the percentage — do not apply colour coding or warnings to stale data.

### Smoke test guard

After parsing, before writing to cache, assert that the output contains at least one `% used` (cc) or `% left` (cx) match. If not, log a warning and skip writing — prevents silently caching empty/corrupt data if Anthropic or OpenAI change the `/status` UI format.

## Dependencies

- Dashboard server must be running for polling to occur (poller started inside `dashboard-server.js`)
- `claude` binary on PATH for cc polling
- `codex` binary on PATH for cx polling
- `--dangerously-skip-permissions` flag required for throwaway Claude Code session (used elsewhere in aigon already)
- tmux must be available (already a hard dependency for worktree sessions)

## Out of Scope

- Gemini (`gg`) and Cursor (`cu`) — neither exposes budget via CLI; architecture leaves room to add later
- Predictive "will run out at X time" modelling
- Budget alerts / push notifications
- Automatically selecting a different agent — user always decides; feature only informs
- Polling when dashboard is not running

## Open Questions

- Claude Code's Usage tab requires a Right-arrow navigation after `/status`. If Anthropic changes the tab order, the poll silently captures the wrong tab. The smoke test guard (assert `% used` present) is the safety net — is that sufficient or do we need a more explicit tab-name assertion?

## Related

- Research: none
- Validated live: Claude Code `/status` Usage tab parsing confirmed 2026-04-23, cost $0.00, zero tokens
- Validated live: Codex startup banner contains `5h limit` and `Weekly limit` progress bars with `% left` values
