# Feature: fix dashboard open in finder button

## Summary
The dashboard kanban shows an "N more — open in Finder" button at the bottom of any column with more cards than fit in the visible area (typically 6+). Clicking the button does nothing — no Finder window opens, no error, no console output. The button renders as if it's clickable (blue border, hover state) but the click handler is broken or the server endpoint doesn't fire `open` correctly.

Bug discovered 2026-04-07 while verifying the OSS/Pro split in the aigon-pro Done column.

## User Stories
- [ ] As a user with a column overflowing the visible area, I can click "N more — open in Finder" and the matching spec folder opens in macOS Finder
- [ ] If the click fails (e.g. Linux, no Finder), the button surfaces a clear error rather than doing nothing silently

## Acceptance Criteria
- [ ] Clicking "N more — open in Finder" in any kanban column opens the corresponding `docs/specs/<entity>/<stage>/` folder in Finder on macOS
- [ ] On Linux/Windows, the button either opens the platform's file manager (xdg-open / explorer.exe) or shows a clear "not supported on this platform" message — current silent failure is unacceptable
- [ ] The click triggers a visible network request to the dashboard server (verifiable in DevTools Network tab)
- [ ] The server endpoint that handles the click returns 200 on success and a structured error on failure
- [ ] On failure, the button surfaces the error to the user (toast / inline message) — no silent fail
- [ ] Verified manually in both aigon and aigon-pro repos
- [ ] Regression test added so this doesn't break again silently

## Validation
```bash
node --check lib/dashboard-server.js
node --check templates/dashboard/js/board.js
MOCK_DELAY=fast npm run test:ui
```

## Technical Approach

### 1. Reproduce
- Open dashboard against any repo with >6 done features
- Click the "N more — open in Finder" button
- Capture: click event firing? Network request firing? Server response? `open` shell command running?

### 2. Diagnose where the chain breaks
Three layers to check:

| Layer | What to verify |
|---|---|
| Frontend click handler | Is the `onclick` (or event listener) actually attached? Does clicking fire? |
| HTTP request | Is the dashboard server endpoint being called? Check Network tab. |
| Server-side `open` command | Is `child_process.exec('open <path>')` running? Check server logs / strace. |

Most likely failure points:
- Click handler not wired up (template rendering issue)
- Endpoint URL mismatch between frontend and server
- Server endpoint exists but doesn't run `open` (maybe it just returns the path expecting frontend to do something)
- `open` runs but the path is wrong (relative vs absolute, or doesn't account for the repo's actual location)

### 3. Fix
- Ensure click handler is attached
- Ensure HTTP request fires with the correct stage path
- Ensure server endpoint exists and runs `open <absolute path>` (or `xdg-open` on Linux, `explorer.exe` on Windows)
- Surface errors to the frontend so silent failure becomes impossible

### 4. Test
- Manual: click in both repos, verify Finder opens to the right folder
- Automated: add a Playwright test that clicks the button and asserts a network request fires (can't easily verify the OS-level Finder open in CI, but verifying the request fires is enough to catch silent regressions)

## Dependencies
- None — pure dashboard bug fix

## Out of Scope
- Redesigning the kanban column overflow UX
- Adding "open in VS Code" or other editor integrations
- Mobile / non-desktop dashboard support

## Open Questions
- Is this bug pre-existing or introduced recently? (Check if it works in aigon's Done column too — if yes, recent regression; if no, pre-existing)
- Should the Linux/Windows fallback open the platform file manager, or just show a "macOS only" message?

## Related
- Discovered during the 2026-04-07 OSS/Pro split verification (aigon-pro Done column)
- `lib/dashboard-server.js` — likely server endpoint location
- `templates/dashboard/js/board.js` or similar — likely frontend click handler location
