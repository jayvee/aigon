---
commit_count: 1
lines_added: 366
lines_removed: 1
files_touched: 4
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
---
# Implementation Log: Feature 430 - transcript-tmux-pipe-pane-optin
Agent: cc

## Status
Done

## New API Surface
- `lib/config.js` — `isTmuxTranscriptCaptureEnabled()`, `getTmuxTranscriptOptions()`, `DEFAULT_GLOBAL_CONFIG.transcripts`
- `lib/worktree.js` — `_attachTmuxPipePane`, `_ensureTmuxRotateScript`, `_getCapturableAgents` (internal); `createDetachedTmuxSession` now conditionally attaches pipe-pane
- `lib/transcript-read.js` — `collectTranscriptRecords` now surfaces `captured:true` with `tmuxLogPath` for non-native agents when the file exists; adds `tmuxLogPath` field to native-agent records too

## Key Decisions
- `CAPTURABLE_AGENTS` derived from `agentRegistry.getCapturableAgentIds()` (agents with a `sessionStrategy`) — avoids hardcoding cu/op/km and stays in sync with future agent additions.
- Rotation implemented via `~/.aigon/scripts/aigon-tmux-pipe-pane.sh` (written once on first use) — kept as a shell script to avoid spawning a Node.js process per session. Script reads line-by-line and rotates every 500 lines that exceed cap.
- `sessionUuid` for the log path is generated at session-creation time with `crypto.randomUUID()` — independent of the native `agentSessionId` which arrives async via `spawnCaptureProcess`.
- Log path written to the sidecar via `updateSessionSidecar` immediately after pipe-pane is attached; the read model reads it from there.
- `isTmuxTranscriptCaptureEnabled()` reads from global config only (not project config) — machine-level privacy/security decision.

## Gotchas / Known Issues
- Pre-existing test failure in `tests/integration/worktree-state-reconcile.test.js` (Cursor CLI tmux launch assertions) — unrelated, documented since F427.
- `shellQuote` is declared at line ~1469 in `worktree.js` but used by helpers defined earlier; safe because module init runs before any caller invokes the functions.

## Explicitly Deferred
- Per-agent override (`transcripts.tmux.cu = true`) — deferred per spec open question; implementation cost is non-trivial.
- ANSI sanitisation — raw stream only; rendering deferred.
- Stuck-detection signal from byte growth — separate future feature per research synthesis.

## For the Next Feature in This Set
- F431 (transcript-dashboard-surface) can read `tmuxLogPath` from `collectTranscriptRecords` records — field is present for non-native agents when capture was enabled.
- The `tmuxLogPath` field is also added to native-agent records (always null currently) for schema consistency.

## Test Coverage
- `tests/integration/transcript-tmux-pipe-pane.test.js` — 6 tests:
  - REGRESSION: flag-off → not-captured record, no tmuxLogPath
  - REGRESSION: flag-on + cu + existing log → captured:true with tmuxLogPath
  - REGRESSION: flag-on + cu + missing log file → not-captured
  - REGRESSION: flag-on + cc (native) → uses native path, no tmuxLogPath
  - Default config: `transcripts.tmux` defaults to false, tmuxMaxBytes > 0
  - Rotation: log.1 created when size cap exceeded, no log.4+ files

## Code Review

**Reviewed by**: composer (code-review pass)
**Date**: 2026-04-28

### Fixes Applied
- `fix(review): align tmux pipe-pane log role default with sidecar (do)` — `createDetachedTmuxSession` used `meta.role || 'implement'` for the tmux log basename while `writeSessionSidecarRecord` defaults entity role to `'do'`. Any caller omitting `role` would have produced `implement-<uuid>.tmux.log` alongside a sidecar claiming `role: do`; aligned defaults to `'do'`.

### Residual Issues
- **Rotation test vs shipped script**: `transcript-tmux-pipe-pane.test.js` embeds a simplified shell snippet (`check_every=1`) rather than executing `~/.aigon/scripts/aigon-tmux-pipe-pane.sh`, so drift in the real script would not be caught by CI. Acceptable for v1 but worth tightening later if this script churns.
- **Implementation log wording**: “rotates every 500 lines that exceed cap” is imprecise — production checks file **size** against `CAP` every 500 **lines** read (batching), not line-count-based rotation.
- **`npm run test:iterate`**: `transcript-read.test.js` exited with `spawn code -w ENOENT` after passing assertions (environment missing VS Code CLI); unrelated to F430.

### Notes
- Acceptance criteria are largely met: global `transcripts.*` defaults, `getCapturableAgentIds()` matches “native capture” vs tmux-only agents, path matches transcript-store layout, read-model exposes `tmuxLogPath`, rotation keeps `.1`–`.3` with configurable cap.
- Repo-scoped “ask” tmux sessions omit `entityType`/`entityId`, so pipe-pane correctly does not attach there.
