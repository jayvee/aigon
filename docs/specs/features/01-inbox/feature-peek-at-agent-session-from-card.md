# Feature: Peek at Agent Session from Card

## Summary

Add a "Peek" button to each agent row on a feature card that shows the last N lines of the tmux session output inline — without navigating to the Sessions tab. One click reveals what the agent is doing right now, how long it's been going, and where it's up to. Like a quick glance over the agent's shoulder.

## User Stories

- [ ] As a user watching the pipeline, I want to peek at what an agent is doing without leaving the monitor view
- [ ] As a user with multiple features running, I want to quickly scan each agent's current activity from their cards
- [ ] As a user, I want to see the agent's last few lines of output to know if it's stuck, coding, or waiting for input

## Acceptance Criteria

### Peek button on card
- [ ] Each agent row on an in-progress card shows a "Peek" button (eye icon or similar)
- [ ] Each review session row also shows a "Peek" button
- [ ] Each eval session row also shows a "Peek" button
- [ ] Clicking Peek expands an inline panel below the row showing the last 15-20 lines of the tmux session
- [ ] Clicking Peek again (or a close button) collapses the panel
- [ ] The panel auto-refreshes every 5 seconds while open
- [ ] If the tmux session doesn't exist, show "Session not running"

### Content display
- [ ] Shows the raw terminal output (last N lines from `tmux capture-pane`)
- [ ] Rendered in a monospace font with dark background (terminal-like)
- [ ] ANSI color codes stripped (plain text is fine — don't try to render colors)
- [ ] Shows a header with: session name, uptime, last activity timestamp
- [ ] Compact — doesn't push other cards off screen. Max height ~200px with scroll.

### API
- [ ] New endpoint `GET /api/peek/:featureId/:agentId` returns `{ lines: string[], sessionName: string, uptime: string, alive: boolean }`
- [ ] Uses `tmux capture-pane -t <session> -p` to get output
- [ ] Returns last 20 lines by default, accepts `?lines=N` parameter

## Validation

```bash
node -c aigon-cli.js
node -c lib/dashboard-server.js
```

## Technical Approach

### API endpoint (~15 lines in dashboard-server.js)

```js
// GET /api/peek/:featureId/:agentId
const sessionName = buildTmuxSessionName(featureId, agentId, { repo });
const lines = spawnSync('tmux', ['capture-pane', '-t', sessionName, '-p'], { encoding: 'utf8' });
const output = lines.stdout.split('\n').slice(-20);
res.json({ lines: output, sessionName, alive: tmuxSessionExists(sessionName) });
```

### Frontend (~40 lines in pipeline.js)

Add a small eye icon button to `buildAgentSectionHtml()`. On click, fetch `/api/peek/{id}/{agent}`, toggle a `<pre>` block below the agent row. Set a 5-second interval while open, clear on close.

### Key files:
- `lib/dashboard-server.js` — add peek endpoint
- `templates/dashboard/js/pipeline.js` — add peek button + inline panel
- `templates/dashboard/styles.css` — terminal-like styling for peek panel

## Dependencies

- None

## Out of Scope

- Full terminal emulator in the dashboard (this is plain text peek, not interactive)
- Sending input to the agent session
- Historical session output (only live/current)

## Open Questions

- Should peek also show the deep status info (commits, cost) or just terminal output? (Recommend: just terminal — deep status is already in the Status tab)
- Should the peek panel persist across dashboard refreshes or always start collapsed?

## Related

- Feature 199: Feature Status Panel (provides deep status — peek is complementary, showing raw terminal output)
