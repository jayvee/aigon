# Implementation Log: Feature 459 - dashboard-status-collector-skip-done-reads
Agent: cu

## Status

Implemented F459: `collectDoneSpecs` enumerates `05-done/` filenames only (numeric id descending for `recent` / `all`). Removed per-poll workflow `snapshot.json` + `events.jsonl` walks. `extraDone` rows now use `safeStatIsoTimes` on the spec path when merging into `allFeatures` (only entries not already in the workflow-driven grid).

## New API Surface

None. `collectDoneSpecs(doneDir, pattern, limit, options)` still returns `{ total, all, recent }`; each item is `{ file }` only (callers must not rely on inline mtime/birthtime from `collectDoneSpecs`).

## Key Decisions

- Dropped engine-done UNION for dashboard display: engine-done feature with no `05-done/` file no longer appears in `collectDoneSpecs` until the spec is moved — acceptable one-cycle lag per spec.
- F397 `isEntityDone()` and other engine-first callers unchanged.

## Gotchas / Known Issues

- Pre-push `npm test` on this machine may fail `plan-flag-draft.test.js` if local Codex config injects plan tokens; unrelated to this change.

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

- `tests/integration/engine-first-folder-fallback.test.js` — REGRESSION: F459 folder-only `collectDoneSpecs`; F397 cases above unchanged.
