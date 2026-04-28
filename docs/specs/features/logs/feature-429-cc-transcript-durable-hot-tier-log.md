---
commit_count: 3
lines_added: 609
lines_removed: 2
lines_changed: 611
files_touched: 8
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 19866
output_tokens: 39553
cache_creation_input_tokens: 237843
cache_read_input_tokens: 7430116
thinking_tokens: 0
total_tokens: 7727378
billable_tokens: 59419
cost_usd: 3.7738
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 429 - transcript-durable-hot-tier
Agent: cc

## Status
Done

## New API Surface
- `lib/transcript-store.js` — `copySessionToDurable`, `finaliseEntityTranscripts`, `snapshotQuarantineTranscripts`, `renameTranscriptDirSync`, `findDurablePath`, `resolveTranscriptEntityDir`
- CLI: `aigon agent-quarantine <agentId> <modelId> [--dry-run]` — snapshots active sessions then marks model quarantined
- Hot-tier layout: `~/.aigon/transcripts/<repoName>/<entityType>/<entityId>/<agentId>/<role>-<sessionUuid>.{ext,meta.json}`
- Quarantine layout: `~/.aigon/transcripts/<repoName>/quarantine/<ts>-<model>/<agentId>/<role>-<sessionUuid>.{ext,meta.json}`

## Key Decisions
- `role` in filename derived from telemetry record's `activity` field (defaults to 'implement'); no sidecar schema change needed.
- `renameTranscriptDirSync` runs inside the existing `migrateEntityWorkflowIdSync` lock — no new lock added. Collision appends `.collision-<sha8>` rather than throwing, so a race can't block prioritise.
- `finaliseEntityTranscripts` called as Phase 6.5a in feature-close (after telemetry, before worktree deletion) — ordering ensures sidecar/telemetry records are current before the copy.
- `agent-quarantine` snapshots transcripts *before* mutating the agent JSON so audit evidence is captured even if the matrix write fails.
- `collectTranscriptRecords` now surfaces `durablePath` in the record and uses it as `agentSessionPath` when present — analytics consumers get the stable path automatically without any schema change.

## Gotchas / Known Issues
- Pre-existing test failure in `tests/integration/worktree-state-reconcile.test.js` (Cursor CLI tmux assertions) — unrelated to this feature (documented in F427 log).
- Gemini single-JSON-blob (`gemini-chats` strategy): the native file is a single mutable JSON; mid-session snapshot is safe (copy is atomic) but the body may be partial if Gemini hasn't flushed. The meta `complete` flag reflects whether the copy succeeded, not whether the session was finished.

## Explicitly Deferred
- Dashboard "Transcript" column showing durable path or copy status (F431).
- Cold-tier upload (S3/R2/GCS).
- Redaction pipeline.
- Retention GC (decide after 90 days usage data).
- Snapshot at `feature-reset` (open question in spec; same `finaliseEntityTranscripts` call would work — wired when reset flow is cleaned up).

## For the Next Feature in This Set
- F431 (transcript-dashboard-surface) can read `durablePath` directly from `collectTranscriptRecords` records — the field is already populated when a hot-tier copy exists.
- The `~/.aigon/transcripts/<repoName>/` base is deterministic (`path.basename(repoPath)`) — dashboard can enumerate across repos by listing the transcripts root.

## Test Coverage
- `tests/integration/transcript-store.test.js` — 6 tests:
  - `finaliseEntityTranscripts` copies body + writes meta + leaves native intact (REGRESSION: feature-close → file copied)
  - `snapshotQuarantineTranscripts` creates quarantine dir with body + meta, filters to target agent only (REGRESSION: quarantine → snapshot directory created)
  - `renameTranscriptDirSync` renames slug→numeric dir (REGRESSION: prioritise → slug directory renamed)
  - `renameTranscriptDirSync` no-op when source absent
  - `copySessionToDurable` writes meta even when native body missing
  - `findDurablePath` returns null when no hot-tier copy exists
