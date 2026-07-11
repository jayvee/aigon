# Implementation Log: Feature 670 - stable-spec-layout-5-lifecycle-cutover-and-legacy-retirement
Agent: cx

## Status

Implemented and committed. Stable-layout lifecycle writes now keep canonical
feature/research specs in `00-specs`, refresh the generated lifecycle view after
workflow state is published, and preserve legacy stage-folder moves only for
`specLayout: legacy`.

## New API Surface

- `lib/spec-layout-core.js`: leaf stable-layout helpers for
  `isStableLayout`, canonical spec discovery, and canonical spec listing without
  importing the migration/SpecStore layer.
- `lib/spec-lifecycle.js`: shared command/engine helper for stable-layout
  lifecycle decisions, `move_spec` filtering, canonical spec lookup, and
  repairable lifecycle-view refresh warnings.

## Key Decisions

- Workflow-core no longer emits feature/research lifecycle `move_spec` effects
  under stable layout; post-write publication still happens first, then the
  generated view is refreshed.
- Historical or explicit `move_spec` effects are compatibility metadata under
  stable layout: executors refresh the view and do not rename tracked Markdown.
- Feature/research prioritise/start/pause/resume/eval/close/reset/unprioritise
  paths skip canonical spec moves and spec-move commits under stable layout.
- Reconciliation for feature/research under stable layout refreshes the view
  instead of performing physical drift-correction renames. Feedback remains on
  its existing folder-location model.
- Template and architecture docs now describe canonical `00-specs` content and
  generated lifecycle views instead of stage folders as durable authority.

## Gotchas / Known Issues

- `npm test` was rerun too broadly during validation. The later rerun was
  stopped at the operator's request; the exact previously failing test
  `tests/integration/spec-author-provenance.test.js` was rerun and passed.
- A lint gate exposed unrelated stale lint in `lib/agent-exhaustion-detect.js`
  and existing integration tests; minimal fixes are included so the suite can
  progress.

## Explicitly Deferred

- No Pro/internal behaviour changes.
- Legacy `specLayout: legacy` remains supported during the compatibility
  window and still uses the old stage-folder move model.

## For the Next Feature in This Set

- If further hardening is needed, focus on content-dependent commands refusing
  missing canonical content with an actionable "update main" message across
  every CLI surface; the resolver/read-model foundations are in place.

## Test Coverage

- Passed: `node tests/integration/spec-view-projection.test.js`
- Passed: `node tests/integration/portable-spec-paths.test.js`
- Passed: `node tests/integration/spec-author-provenance.test.js`
- Passed: `node tests/integration/two-clone-git-branch-storage.test.js` in an
  earlier run before the final test-expectation-only fix.
- Passed: `npm run test:workflow`
- Passed: `node scripts/check-template-leaks.js`
- Passed: `node scripts/check-module-graph.js --report`

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-11

### Fixes Applied
- None — implementation was clean.

### Validation
- Passed: `npm run lint`
- Passed: `npm run test:unit`
- Passed: `npm run test:integration` (98/98)
- Passed: `npm run test:workflow`
- Passed: `node tests/integration/spec-view-projection.test.js` (includes stable move_spec + reconciliation cases)
- Passed: `node tests/integration/two-clone-git-branch-storage.test.js`
- Passed: `node scripts/check-template-leaks.js`
- Passed: `node scripts/check-module-graph.js --report`
- Note: `npm run test:core` still fails at pre-existing `lint:paths` findings on `main` (unrelated to F670).

### Escalated Issues (exceptions only)
- **ESCALATE:subsystem** — Content-dependent commands surfacing an actionable "update main" message when canonical content is missing/stale is documented as follow-up hardening in the implementation log; resolver foundations are in place but not every CLI surface was audited in this branch.
- **ESCALATE:subsystem** — `feature-transfer` cross-repo canonical read/write contract from the spec was not explicitly exercised with new tests; same-repo agent handoff already routes spec reads through the canonical resolver and `startFeature` now respects stable layout.

### Notes
- Central `lib/spec-lifecycle.js` + `lib/spec-layout-core.js` cleanly gate `move_spec` emission (engine), execution (effects), and command-side commits while refreshing `spec-view` after workflow publication — good write-path/read-path alignment.
- Legacy `specLayout: legacy` paths are preserved behind `shouldMoveSpecFiles()`; regression risk is low given existing lifecycle integration coverage.
- `agent-exhaustion-detect.js` paneTail change is consistent with live-pane heuristic removal (F668), not an accidental regression.
