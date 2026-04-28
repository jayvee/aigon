# Implementation Log: Feature 427 - transcript-read-model-and-cli
Agent: km

## Status
Done

## New API Surface
- `lib/transcript-read.js` — `collectTranscriptRecords`, `formatTranscriptCliOutput`, `openTranscriptPath`
- CLI: `aigon feature-transcript <ID> [agent] [--open]`
- CLI: `aigon research-transcript <ID> [agent] [--open]`
- API: `GET /api/features/:id/transcripts?agent=&repoPath=`
- API: `GET /api/research/:id/transcripts?agent=&repoPath=`

## Key Decisions
- Reused the existing partial scaffold in `lib/commands/entity-commands.js` and `lib/dashboard-routes/transcripts.js` that was already present in the worktree. The only missing pieces were the implementation of `lib/transcript-read.js` and wiring the route module into `lib/dashboard-routes.js` (already wired).
- Missing-pointer cases (cu/op/km, or pre-F357 sessions) return structured `captured: false` records with a one-line explanation, never a stack trace.
- `--open` defaults to `$EDITOR`, then platform-specific viewer (`open` on macOS, `xdg-open` on Linux, `start` on Windows).
- Telemetry join uses `featureId + agent + sessionId` from normalized `.aigon/telemetry/*.json` records.

## Gotchas / Known Issues
- Pre-existing test failure in `tests/integration/worktree-state-reconcile.test.js` (Cursor CLI tmux launch assertions) — unrelated to this feature.

## Explicitly Deferred
- Dashboard "Open transcript" UI button/link (frontend rendering deferred to a follow-up change).
- API preview of transcript body (head/tail) — strictly pointer-only for now.

## For the Next Feature in This Set
- `transcript-durable-hot-tier` can build on the read-model API and CLI patterns established here.

## Test Coverage
- `tests/integration/transcript-read.test.js` — 7 tests covering:
  - Empty sessions
  - Not-captured for agents without session strategy (cu/op/km)
  - Not-captured for pre-F357 sessions
  - Captured record with telemetry join
  - Agent filter
  - CLI output formatting
  - Platform open helper
