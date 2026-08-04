# Implementation Log: Feature 740 - backup-restore-integrity

## Status

Implementation complete. The restore path now previews and exactly replaces the
portable Vault scope while preserving machine-local runtime state and creating a
timestamped pre-restore archive.

## New API Surface

- `aigon backup pull --dry-run` reports the Vault SHA and per-project add,
  change, and removal counts without mutating project or global settings state.
- Successful `aigon backup pull` reports the pre-restore archive path and leaves
  the local backup schedule set to `off`.

## Key Decisions

- Treat Vault as a recovery snapshot, not a bidirectional merge engine.
- Replace the filtered managed `.aigon` scope exactly so files absent from the
  snapshot cannot linger and make the dashboard show mixed state.
- Preserve excluded sessions, locks, caches, server state, logs, and explicitly
  machine-local global settings during the replacement.
- Disable the backup schedule before restore mutation, so a failed or partial
  restore still cannot be automatically pushed by dashboard startup.
- Keep active cross-machine lifecycle collaboration on the existing
  `git-branch` SpecStore rather than adding conflict manifests to Vault.

## Gotchas / Known Issues

- File counts can be large when telemetry retention replaces raw telemetry with
  compressed `.gz` files; the dry-run count is exact but not semantic.
- Projects in the Vault that cannot be resolved to a registered or known local
  repository are reported and left untouched.
- Each project directory swap is atomic, but a failure after an earlier project
  succeeds can leave a partial multi-project restore. Every pre-state is retained
  in the reported archive for manual recovery.

## Explicitly Deferred

- Three-way Vault merges, conflict manifests, and cross-project transactions.
- Automatic conversion of registered projects to `git-branch` SpecStore.
- Restoring machine-local sessions, locks, caches, server processes, or backup
  credentials and schedules.

## For the Next Feature in This Set

None. Consider a separate operator-facing archive inspection/rollback command
only if real recovery use shows that manual archive restoration is too difficult.

## Test Coverage

- `node tests/unit/backup.test.js` — 11 passing tests, including dry-run
  immutability, stale-file pruning, excluded-session preservation, archive
  creation, machine-local backup configuration, and schedule shutdown.
- `npm run test:iterate` — passed.
- `node -c lib/backup.js` — passed.
- `node scripts/check-code-tour.js` — 49 anchors and 38 excerpts passed; the
  changed backup code is not quoted by the code tour.
- `bash scripts/check-test-budget.sh` — 18,189 / 200,000 LOC (9%).
- Live Machine B preview against Vault SHA `a1e2c6fdb034f9e5b34ad07986c70ab2ba91b53b`
  completed without applying state.
