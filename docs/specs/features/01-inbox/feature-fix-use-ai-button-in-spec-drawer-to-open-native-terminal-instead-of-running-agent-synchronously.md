# Feature: Fix Use AI button in spec drawer to open native terminal instead of running agent synchronously

## Summary

The "Use AI" button in the spec drawer (`launchAiSession`) currently calls `/api/session/run` which runs the agent command synchronously and waits for it to exit. Interactive agents (claude, gemini, codex) run indefinitely, so this hangs the browser until the server times out. The fix is to use `/api/open-terminal` instead — open a native terminal window running the agent command, and show "Session opened in your terminal" in the panel, matching how all other terminal-mode actions work post-feature-70.

## User Stories

- [ ] As a user, I click "Use AI" on a spec in the drawer and a native terminal window opens with the agent already running, so I can interact with it directly
- [ ] As a user, the dashboard panel shows "Session opened in your terminal" immediately after clicking "Use AI", without hanging waiting for the agent to exit

## Acceptance Criteria

- [ ] Clicking "Use AI" in the spec drawer calls `POST /api/open-terminal` with the agent command and `cwd` set to the repo path
- [ ] A native terminal window opens (Terminal.app / iTerm2 per user config) with the agent command running
- [ ] The terminal panel overlay shows "Session opened in your terminal" immediately (no spinner, no hang)
- [ ] No call to `/api/session/run` or `/api/session/start` is made from `launchAiSession`
- [ ] `node -c` passes on all JS files

## Validation

```bash
node -c lib/utils.js && node -c lib/commands/shared.js && node -c templates/dashboard/index.html 2>/dev/null || echo "HTML not node-checkable (ok)"
npm test
```

## Technical Approach

In `templates/dashboard/index.html`, the `launchAiSession` function (around line 994):

**Current (broken):**
```js
const res = await fetch('/api/session/run', { ... body: { command, cwd } });
const data = await res.json();
const output = (data.stdout || '') + ...;
openTerminalPanel(label, command, null, output || 'Session launched.', specCtx);
```

**New:**
```js
const res = await fetch('/api/open-terminal', { ... body: { command, cwd: repoPath || '' } });
if (!res.ok) { showToast('Failed to open terminal: ' + ...); return; }
openTerminalPanel(label, command, null, null, specCtx);
// panel shows "Session opened in your terminal"
```

The `/api/open-terminal` endpoint already exists (added in feature-70) and calls `openTerminalAppWithCommand(cwd, command)` server-side. No server changes needed — this is a one-line fix in the HTML template.

The spec drawer also auto-opens fullscreen on `launchAiSession` — keep that behaviour.

## Dependencies

- Feature 70 (dashboard infrastructure rebuild) — must be merged first, as `/api/open-terminal` was introduced there

## Out of Scope

- Changing how agent picker works or which agents are offered
- Tracking the agent session or showing output in the panel
- Any server-side changes

## Open Questions

-

## Related

- Feature 70: Dashboard Infrastructure Rebuild (introduced `/api/open-terminal`)
