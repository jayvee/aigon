# Feature: Dashboard Console Tab

## Summary

Add a "Console" tab to the dashboard that shows a live, scrollable log of every action the dashboard executes — API calls, CLI commands, their stdout/stderr, exit codes, and outcomes. Currently the dashboard logs to `~/.aigon/dashboard.log` but the user never sees this output; the toast just says "Done" even when actions silently fail (e.g., `feature-close 80` returned exit code 0 but stderr contained a git error and the spec never moved). The Console tab surfaces this hidden information so the user can see exactly what happened and why.

## User Stories

- [ ] As a user, when I click an action button and the toast says "Done", I can open the Console tab to see the full stdout/stderr of what actually ran
- [ ] As a user, when an action silently fails (exit 0 but nothing happened), I can see the stderr output in the Console to understand why
- [ ] As a user, I can see a chronological log of all dashboard activity (actions, poll events, errors) without needing to SSH into the machine and tail a log file
- [ ] As a user, I can see which actions failed at a glance because they're visually distinct from successful ones

## Acceptance Criteria

### Server-side: in-memory event buffer + API

- [ ] New in-memory ring buffer in the AIGON server (max 200 entries) that captures every action/event with: `{ timestamp, type, action, args, repoPath, command, exitCode, ok, stdout, stderr, duration }`
- [ ] Event types: `action` (user-triggered via /api/action), `poll` (status poll cycle — only logged when something changes), `error` (server-side errors), `session` (session run via /api/session/run)
- [ ] Every `/api/action` call appends to the buffer with the full `runRadarInteractiveAction` result including stdout and stderr (not truncated)
- [ ] Every `/api/session/run` call appends to the buffer
- [ ] New endpoint `GET /api/console` returns the buffer as JSON: `{ events: [...] }`
- [ ] Buffer does NOT persist across dashboard restarts (in-memory only)

### Client-side: Console tab

- [ ] New "Console" tab button in the nav bar between "Logs" and "Settings"
- [ ] Console view renders as a monospace, terminal-style scrolling log
- [ ] Each entry shows: timestamp, action/command, exit code, and a status indicator (green checkmark for ok, red X for failure)
- [ ] Clicking an entry expands it to show full stdout and stderr in a collapsible detail section
- [ ] Stderr is shown in a distinct colour (red/orange) so errors are immediately visible
- [ ] Auto-scrolls to bottom on new entries (with scroll-lock: if user has scrolled up, don't auto-scroll)
- [ ] Refreshes on each poll cycle (same cadence as the rest of the dashboard)
- [ ] "Clear" button to empty the console (client-side only — clears the display, not the server buffer)
- [ ] Uses Geist Mono / monospace font consistent with the existing Logs tab styling

### Toast improvement (bonus)

- [ ] When an action completes, if stderr contains error indicators (`fatal:`, `error:`, `❌`, `Error:`), the toast should show as an error toast (red) even if exit code was 0, with a "See Console" hint
- [ ] This fixes the core UX problem: user clicks "Accept & Close", toast says "Done" in green, but nothing happened

## Validation

```bash
node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done
npm test
```

## Technical Approach

### Server-side

Add a `consoleBuffer` array at the top of `runDashboardServer()`, alongside the existing `lastStatusByAgent` and `allSubmittedNotified` state:

```javascript
const consoleBuffer = [];
const CONSOLE_BUFFER_MAX = 200;

function logToConsole(entry) {
    entry.timestamp = new Date().toISOString();
    consoleBuffer.push(entry);
    if (consoleBuffer.length > CONSOLE_BUFFER_MAX) consoleBuffer.shift();
    // Also write to the existing dashboard log file
    log(`${entry.type}: ${entry.command || entry.action} | ok=${entry.ok} exitCode=${entry.exitCode}`);
}
```

Instrument the `/api/action` handler (L2687-L2728) to call `logToConsole()` with the full result from `runRadarInteractiveAction()`:

```javascript
const startTime = Date.now();
const result = runRadarInteractiveAction({ ... });
logToConsole({
    type: 'action',
    action: payload.action,
    args: payload.args,
    repoPath: result.repoPath,
    command: result.command,
    exitCode: result.exitCode,
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
    duration: Date.now() - startTime
});
```

Similarly instrument `/api/session/run`.

New endpoint:
```javascript
if (reqPath === '/api/console') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ events: consoleBuffer }));
    return;
}
```

### Client-side

Follow the exact pattern used by the existing tabs (Sessions, Statistics, Logs, Settings):

1. Add `<button class="view-tab" id="tab-console" data-view="console">Console</button>` to the nav
2. Add `<div id="console-view" style="display:none"></div>` container
3. Add `console-view` to the display toggle logic in the render function (~L3642-L3699)
4. New `renderConsole()` function that fetches `/api/console` and renders entries

Entry rendering (collapsed):
```
[11:33:48] ✓ aigon feature-close 80                    0.9s
[11:28:42] ✗ aigon feature-close 01                    1.2s
[06:10:07] ✓ aigon feature-setup 01 cc                 3.1s
```

Entry rendering (expanded on click):
```
[11:33:48] ✗ aigon feature-close 80                    0.9s
  ── stdout ──────────────────────────────────────────
  ✅ Feature 80 closed
  ── stderr ──────────────────────────────────────────
  remote:
  remote: Create a pull request for 'feature-80-cc-...' on GitHub
  fatal: could not read from remote repository
```

### CSS

Minimal additions — reuse existing `.logs-*` class patterns for the monospace container. Add:
- `.console-entry` — row with flex layout, clickable
- `.console-entry.error` — red-tinted left border
- `.console-detail` — collapsible stdout/stderr block
- `.console-stderr` — distinct red/orange text colour

### Toast improvement

In `requestAction()` (~L871), after receiving the response, check if stderr contains error patterns before showing the success toast:

```javascript
const stderrError = payload.stderr && /fatal:|error:|❌|Error:/i.test(payload.stderr);
if (stderrError) {
    showToast('Action may have failed — check Console', null, null, { error: true });
} else {
    showToast('Done: ' + (payload.command || action));
}
```

This requires the `/api/action` response to include stdout/stderr in successful responses too (it already does — the `payload` object at L2287-L2296 includes them).

### Work order

1. Add `consoleBuffer` and `logToConsole()` to the AIGON server + `/api/console` endpoint
2. Instrument `/api/action` and `/api/session/run` to log to buffer
3. Add Console tab UI (button, container, render function, display toggle)
4. Add entry rendering with expand/collapse
5. Add toast stderr detection

## Dependencies

- None — extends existing dashboard infrastructure

## Out of Scope

- Persisting console logs across dashboard restarts (in-memory ring buffer only)
- Filtering/searching console entries
- Exporting console logs
- Real-time push (uses existing poll cadence)
- Modifying the existing `~/.aigon/dashboard.log` file format

## Open Questions

- Should poll cycle events be logged to the console? They'd be noisy (~every 30s). Recommendation: only log polls that detect a status change, not every cycle.

## Related

- Feature 80: centralised-dashboard-notification-system (related observability improvement)
- Dashboard log file: `~/.aigon/dashboard.log` (`DASHBOARD_LOG_FILE` in `lib/utils.js:240`)
- `/api/action` handler: `lib/utils.js:2687`
- `runRadarInteractiveAction()`: `lib/utils.js:2262`
- Existing tab pattern: Sessions, Statistics, Logs, Settings in `templates/dashboard/index.html`
