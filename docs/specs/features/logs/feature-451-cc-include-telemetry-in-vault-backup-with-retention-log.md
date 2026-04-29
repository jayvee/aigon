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
