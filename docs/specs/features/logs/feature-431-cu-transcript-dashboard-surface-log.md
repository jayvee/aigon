---
commit_count: 2
lines_added: 290
lines_removed: 17
lines_changed: 307
files_touched: 7
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "composer"
---
# Implementation Log: Feature 431 - transcript-dashboard-surface
Agent: cu

## Status
Done

## New API Surface
- `GET /api/features/:id/transcripts/download` and `GET /api/research/:id/transcripts/download` — query: `repoPath`, `agent` (required), optional `sessionId` / `sessionName` for disambiguation. Streams `application/octet-stream` with `Content-Disposition: attachment`.
- `lib/transcript-read.js` — `resolveTranscriptDownload(repoPath, entityType, entityId, query)` — resolves filesystem path only via `collectTranscriptRecords` (never client-supplied paths).

## Key Decisions
- **Pointer-only**: no head/tail preview API in this pass (explicitly deferred per F427/F431 scope).
- **Server-mediated open**: dashboard uses same-origin download links built from read-model fields (`sessionId` or `sessionName`); handler re-resolves path on every request.
- **UI placement**: Spec drawer **Agents** tab — per-agent Transcript row with full structured reasons when `captured: false`. **Status** tab — Transcript block for primary agent; Fleet **Agent Sessions** rows append inline “Open transcript” when exactly one captured session (plus “(+N)” when more — use Agents tab for the rest).
- **Preview test env**: `npm run test:iterate` Playwright step failed here with “Server at http://127.0.0.1:4119 did not start within 20000ms” (local harness / timing). Unit + integration transcript tests pass; run `MOCK_DELAY=fast npm run test:ui` from a machine with a healthy dashboard server when pushing.

## Gotchas / Known Issues
- `openTranscriptPath` treats `EDITOR` as a single executable name — tests now clear `EDITOR` to avoid `spawn ENOENT` when `EDITOR` contains spaces (e.g. `code -w`).

## Explicitly Deferred
- Bounded transcript preview API and in-dashboard preview pane.

## For the Next Feature in This Set
- Optional: preview endpoint + modal; ANSI sanitisation if previews are shown as text.

## Test Coverage
- `tests/integration/transcript-read.test.js` — `resolveTranscriptDownload` happy path + session mismatch 404; `openTranscriptPath` test clears `EDITOR` (REGRESSION comments in file).

## Wrap-up
- Spec checkboxes updated (`docs/specs/features/03-in-progress/feature-431-transcript-dashboard-surface.md`).
- `aigon agent-status implementation-complete` succeeded from worktree `feature-431-cu-transcript-dashboard-surface` (branch-derived feature **431**, agent **cu**).
