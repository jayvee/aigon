---
commit_count: 5
lines_added: 125
lines_removed: 20
lines_changed: 145
files_touched: 10
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 217
output_tokens: 62647
cache_creation_input_tokens: 198773
cache_read_input_tokens: 13967181
thinking_tokens: 0
total_tokens: 14228818
billable_tokens: 62864
cost_usd: 5.8759
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 451 - include-telemetry-in-vault-backup-with-retention
Agent: cc

## Status
Implemented across aigon-pro (backup.js, sync-merge.js, tests/backup.test.js) and aigon OSS (lib/telemetry.js, lib/feature-status.js).

## New API Surface
- `applyTelemetryRetention(repoPath, retentionConfig?)` — aigon-pro, called on every `backup push` per registered repo
- `getTelemetryRetentionConfig()` — reads `backup.telemetryRetention` from `~/.aigon/config.json`; accepts optional second arg for testing
- `mergeJsonlByTimestamp(localFile, importedFile)` — aigon-pro sync-merge, replaces conflict-copy for `*.jsonl` telemetry files
- `readTelemetryFile(filePath)` — OSS telemetry.js, transparently reads `.json` or `.json.gz`

## Key Decisions
- `applyTelemetryRetention` accepts an optional `retentionConfig` arg so tests bypass global config without monkey-patching
- `.jsonl` files in any telemetry subdirectory use timestamp-sort merge (not just signal-health); forward-compatible as new subdirs are added
- Retention uses `endAt` field for per-session files, filename date for signal-health jsonl, mtime fallback for either

## Gotchas / Known Issues
- pro repo had unrelated `lib/benchmark-artifacts.js` staged changes; these were left unstaged to keep F451 commit clean

## Explicitly Deferred
- gzip support for signal-health `.jsonl` readers in `lib/signal-health.js` (retention gzips to `.jsonl.gz` but reader still only looks for `.jsonl`)

## For the Next Feature in This Set
- If signal-health reader needs to handle `.jsonl.gz`, extend the regex filter and add gunzip in `lib/signal-health.js:readSignalEvents`

## Test Coverage
9 tests in `aigon-pro/tests/backup.test.js`: PROJECT_EXCLUDES change, default retention values, compress >90d, drop >365d, disabled via 0, disabled via null, signal-health jsonl retention by filename date, jsonl merge sort+dedup, jsonl merge error tolerance.

## Code review (2026-04-29, reviewer: cu)

**Verdict:** Request changes on the OSS side before treating F451 as fully closed against the spec. Pro behavior was not reviewed in this worktree.

### Strengths
- `readTelemetryFile()` in `lib/telemetry.js` correctly gunzips `*.json.gz` and is used by `aggregateNormalizedTelemetryRecords()`.
- `lib/feature-status.js` (`collectCost`) includes `.json.gz` in the filter and reads via `readTelemetryFile`.

### Gaps (acceptance: gzip-tolerant readers “everywhere” for per-session JSON)
These sites still filter to `.json` only and use `fs.readFileSync` without decompression; after vault retention compresses old files, they can miss data or under-report cost/tokens:
- `lib/analytics.js` — `readTelemetryRecords` (dashboard analytics).
- `lib/perf-bench.js` — `readBenchmarkTelemetryUsage` (aigon-eval style reads).
- `lib/transcript-read.js` and `lib/transcript-store.js` — telemetry join for sessions.
- `lib/feature-close.js` — two paths scanning `.aigon/telemetry` for existing records and cost.
- `lib/commands/research.js` — research close cost snapshot from telemetry.

### Tests
- No OSS regression test for `readTelemetryFile` / `.json.gz` (T2 would expect at least one small test).

### Deferred (already logged)
- `lib/signal-health.js` and `.jsonl.gz` remains out of scope until retention affects those files in practice.

### Follow-ups for implementer
1. Route remaining per-session telemetry reads through `readTelemetryFile` (or equivalent) and accept both `.json` and `.json.gz` in directory listings.
2. Add a minimal test that round-trips gzipped telemetry JSON.
3. Confirm Pro retention removes the uncompressed `.json` when writing `.json.gz` to avoid duplicate counting if both extensions are ever globbed.

**Review status:** `aigon agent-status review-complete` recorded for feature 451 (cu).
