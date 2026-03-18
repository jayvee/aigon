---
status: submitted
updated: 2026-03-18T21:09:13.032Z
startedAt: 2026-03-18T20:56:30.068Z
events:
  - { ts: "2026-03-18T20:56:30.068Z", status: implementing }
  - { ts: "2026-03-19T00:00:00.000Z", status: waiting }
  - { ts: "2026-03-18T21:03:21.399Z", status: waiting }
  - { ts: "2026-03-18T21:09:13.032Z", status: submitted }
---

# Implementation Log: Feature 104 - dashboard-manifest-reader
Agent: cc

## Summary

Refactored `collectDashboardStatusData()` in `lib/dashboard-server.js` to read agent lists from coordinator manifests (`.aigon/state/feature-NNN.json`) and per-agent status files (`.aigon/state/feature-NNN-agent.json`) instead of scanning worktree directory names.

## Approach

Minimal, targeted change to the agent-discovery section of `collectDashboardStatusData()`:

1. **Added manifest reading block** (before `specFiles.forEach()` loop): scans `.aigon/state/feature-*.json` per repo into `manifestsByFeatureId` map.

2. **Removed worktree directory scan** (was lines 292-303): the block that scanned worktree dir names to add to `knownAgentsByFeature` was the root cause of phantom agents — removed entirely.

3. **Manifest-first agent assembly** (inside loop): for features with a manifest whose `agents` array is non-empty, reads per-agent status files for `status`/`updatedAt`. Falls back to existing log-based logic for features without manifests.

4. **Added `pending` field** to each feature in the API response, sourced from `manifest.pending`.

## Decisions

- **Kept folder scanning / log scanning** as the backward-compat fallback path. `readManifest()` in `lib/manifest.js` is ROOT_DIR-bound and can't be called for arbitrary multi-repo paths, so manifest JSON is read directly per repo.
- **Worktree scan removal** was the key phantom-agent fix — the scan added agents from worktree names even when no log file existed for them. Manifests are always created before worktrees, so they're authoritative.
- **Playwright failures** (2 tests: agent badge + status dots) were pre-existing before this change — confirmed by reverting and re-running.

## Validation

- `node -c lib/dashboard-server.js` — passes
- `npm test` unit suite: 192 tests pass (0 failures introduced)
- Pre-existing Playwright failures: 2 (unrelated to this change, confirmed by baseline test)
