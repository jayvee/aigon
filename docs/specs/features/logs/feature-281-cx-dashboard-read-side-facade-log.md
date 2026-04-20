---
commit_count: 5
lines_added: 286
lines_removed: 177
lines_changed: 463
files_touched: 7
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 3964978
output_tokens: 27545
cache_creation_input_tokens: 0
cache_read_input_tokens: 3669632
thinking_tokens: 7308
total_tokens: 3992523
billable_tokens: 3999831
cost_usd: 8.8842
sessions: 3
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 281 - dashboard-read-side-facade
Agent: cx

## Plan
- Verify the feature worktree, attach with `aigon feature-do 281`, and keep all edits inside this checkout.
- Move dashboard detail/status file reads out of `lib/dashboard-server.js` into the owner modules already called out by the spec.
- Preserve API behavior, then run the required restart and validation suite before submitting.

## Progress
- Added dashboard-facing read helpers to `lib/agent-status.js` so detail payload assembly no longer parses `.aigon/state/*.json` inline in `dashboard-server.js`.
- Added log/detail helpers and done-count aggregation to `lib/dashboard-status-collector.js`, then rewired `dashboard-server.js` to use them for feature logs, research findings excerpts, and analytics invalidation.
- Replaced visible-folder scanning in `dashboard-server.js` with `lib/feature-spec-resolver.js` lookup so the server no longer probes `docs/specs/*` directly for detail repo resolution.
- Added the boundary marker comment in `lib/dashboard-server.js` and updated `CLAUDE.md` and `docs/architecture.md` so the dashboard read-only rule now includes engine-state/spec/log file access.
- Restarted the AIGON server and ran the validation suite. `npm test`, `MOCK_DELAY=fast npm run test:ui`, and `bash scripts/check-test-budget.sh` all passed. The Playwright run initially failed inside the sandbox because Chromium could not launch, then passed under elevated permissions.

## Decisions
- Kept single-file agent-status parsing in `lib/agent-status.js` and multi-file dashboard aggregation in `lib/dashboard-status-collector.js`, matching the ownership split in the spec.
- Used `lib/feature-spec-resolver.js` for repo/spec discovery instead of adding a new abstraction layer; this keeps the refactor as a relocation rather than a redesign.
- Left only infrastructure-oriented `readFileSync` sites in `lib/dashboard-server.js` after the sweep: global/project config, template/assets, and manifest reads. State/log/spec directory scans were removed from the HTTP module.

## Issues Encountered
- `MOCK_DELAY=fast npm run test:ui` crashed Chromium under sandboxed execution with a Mach port permission error (`browserType.launch: Target page, context or browser has been closed`). Re-ran the same command with elevated permissions and the full 7-test Playwright suite passed.

## Conversation Summary
- The user invoked `aigon-feature-do` for feature 281 in an existing worktree.
- I verified the branch/worktree, attached with `aigon feature-do 281`, implemented the read-side relocation, validated the change set, and prepared the feature for review.

## Code Review

**Reviewed by**: cc
**Date**: 2026-04-20

### Findings
- `buildDetailPayload` renamed `resolvedFeatureSpec` -> `resolvedSpec`, but two references on the stage-fallback chain (feature-only branch) were missed. In strict mode `resolvedFeatureSpec` throws `ReferenceError` whenever `snapshotToStage(snapshot)` returns null (snapshot without lifecycle) or the feature lacks a snapshot (inbox / backlog). Existing tests did not catch this because they exercise features with a lifecycle-backed snapshot, where short-circuit evaluation skipped the dangling reference.
- `stateDir` local in `buildDetailPayload` was left declared after the extraction but no longer referenced.

### Fixes Applied
- `fix(review): restore resolvedSpec reference in buildDetailPayload stage fallback` — renamed the two residual `resolvedFeatureSpec` references and removed the now-unused `stateDir` local.

### Notes
- Spec AC5/AC8 satisfied: `grep fs.readFileSync|fs.readdirSync lib/dashboard-server.js` returns 10 matches, all infrastructure (global/project config, HTML template, assets/ico, manifest, pro files). No reads against `.aigon/` or `docs/specs/`.
- Boundary comment marker (AC7) present at top of `lib/dashboard-server.js`.
- CLAUDE.md Module Map already notes the owner modules (AC10); read-only rule has been strengthened to call out engine-state/spec/log file access (AC9).
- `npm test` and `bash scripts/check-test-budget.sh` passed after the fix (test budget 1971/2000).
