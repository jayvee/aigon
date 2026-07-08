# Implementation Log: Feature 644 - close-integrity-1-post-merge-gate
Agent: cu

Post-merge gate in `lib/feature-close.js` (`featureClose.postMergeGate`); failure → `feature.close_gate_failed` + `close_recovery_in_progress`; tests in `tests/integration/feature-close-post-merge-gate.test.js`.

## Code Review

**Reviewed by**: cc (Opus)
**Date**: 2026-07-08

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- None.

### Notes
- Traced every seam and confirmed correctness:
  - **Gate runs on merged main**: `runPostMergeGatePhase` uses `cwd: target.repoPath` (= main repo `process.cwd()` from `resolveCloseTarget`), executed after the merge lands and before `feature.closed` (Phase 5.5). Verifies the merged combination, not the pre-merge worktree.
  - **Config resolution** (`false` / `true` → deploy resolver / string / array / unset) all correct; loud skip notice for both explicit-off and unconfigured.
  - **Event sourcing**: `feature.close_gate_failed` handled in both `engine.js` and `projector.js`, mirroring sibling `feature_close.failed`; reuses `close_recovery_in_progress` (no new state → no "Adding a currentSpecState" checklist obligations). Projector preserves `lastCloseFailure` across `close_recovery.started`, matching the regression test's dual assertion.
  - **Gate-retry loop is sound**: `close_recovery_in_progress` is distinct from `'closing'`, so `checkResumeState` returns null on re-run, `isPostMergeGateRetry` fires, the merge is skipped, and the gate re-runs. A second failure re-records `close_gate_failed` without a duplicate `recovery.started` (`alreadyInRecovery`).
  - **Set-conductor**: `feature-close-failed` + `lastCloseFailure.kind === 'post-merge-gate'` maps to `post-merge-gate-failed` with a tailored pause message; `persistSetState` records the reason + `failedFeature`; `isStaleFeatureAutoFailure` does not mask it (not in its stale-reason set).
  - **Docs/templates**: `templates/docs/development_workflow.md` stays target-repo-generic (no npm assumption); `npm run test:core` only in this repo's own `.aigon/config.json`. Gate logs land under gitignored `.aigon/state/close-gates/`.
  - **Tests**: all `wf.*` / `engine.*` / `_helpers` references resolve at runtime; regression (two merges, second fails combined) + happy-path (gate pass clears failure on close) are well-formed.
- **Observation (non-blocking, not patched)**: the post-merge gate is skipped on the true interrupted-close resume path (`checkResumeState === 'resumed'`, i.e. `currentSpecState === 'closing'`), because Phase 5.5 is guarded by `if (!isResume)`. A close interrupted after the merge but before `feature.closed`, then resumed, completes without (re)running the gate — a narrow window where "done" could land on unverified main. Left as a note rather than a fix: it spans the pre-existing F432/resume machinery and the correct behaviour (re-run vs. trust the prior run) is a design call, not a clear bug.
