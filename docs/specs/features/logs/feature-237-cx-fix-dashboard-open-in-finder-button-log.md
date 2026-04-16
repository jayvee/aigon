# Implementation Log: Feature 237 - fix-dashboard-open-in-finder-button
Agent: cx

## Plan
- Reproduce and trace the "open in Finder" click path from dashboard UI to server endpoint.
- Fix frontend request wiring and done-folder path resolution for all pipeline entity types.
- Harden server open-folder behavior for macOS/Linux/Windows and return structured errors.
- Add a regression test that verifies the done overflow button sends the expected network request.

## Progress
- Verified workspace branch/worktree and attached with `aigon feature-do 237`.
- Found root cause in `templates/dashboard/js/pipeline.js`: button called `/api/open-path` while server exposes `/api/open-folder`.
- Implemented frontend fix:
  - Route changed to `/api/open-folder`.
  - Added `getDoneFolderPath(repoPath, pipelineType)` for feature/research/feedback done folders.
  - Added structured error parsing from response payload and surfaced errors via toast.
- Implemented backend fix in `lib/dashboard-server.js`:
  - `platformOpen` now supports `darwin` (`open`), `linux` (`xdg-open`), and `win32` (`explorer.exe`).
  - `platformOpen` now throws typed errors for invalid path, unsupported platform, and opener failures.
  - `/api/open-folder` now returns structured error JSON (`{ ok:false, error:{ code, message } }`) on failures.
  - Added backward-compatible alias for legacy `/api/open-path`.
- Added Playwright regression test: `tests/dashboard-e2e/open-folder-button.spec.js`.
  - Deterministically seeds done overflow cards in dashboard store.
  - Clicks "more — open in Finder" and asserts `/api/open-folder` receives the request with done path.
- Restarted server after backend edits: `aigon server restart`.

## Decisions
- Kept compatibility with `/api/open-path` server-side so existing callers do not break during rollout.
- Implemented explicit command exit/error checks in `platformOpen` to eliminate silent failures.
- Scoped regression test to request emission (UI click -> network request), which is the key failure mode described in the spec.
- Validation results:
  - `node --check lib/dashboard-server.js` ✅
  - `node --check templates/dashboard/js/pipeline.js` ✅
  - `MOCK_DELAY=fast npm run test:ui` ⚠️ fails with 3 tests (2 pre-existing lifecycle timeouts waiting on `#tab-console`; new test initially failed before deterministic seeding update)
  - `npx playwright test --config tests/dashboard-e2e/playwright.config.js tests/dashboard-e2e/open-folder-button.spec.js --reporter=list` ✅ (1 passed)

## Conversation Summary
- User requested direct implementation via `aigon feature-do` in the existing feature 237 worktree.
- I followed worktree rules, implemented the dashboard click-path fix and server error handling, added regression coverage, and reported that full UI suite still has unrelated existing failures while the new focused regression passes.
