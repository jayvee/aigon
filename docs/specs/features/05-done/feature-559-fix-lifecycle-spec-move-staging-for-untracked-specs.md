---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-17T23:32:18.088Z", actor: "cli/feature-prioritise" }
---

# Feature: fix lifecycle spec-move staging for untracked specs

## Summary

Fix the lifecycle auto-commit regression that breaks normal spec moves when the source spec was never committed before being renamed. The shared staging helper must treat tracked and untracked sources differently so `feature-prioritise`, `feature-start`, `feature-unprioritise`, and any other lifecycle producer can move specs safely without leaving duplicate tracked paths or fatal pathspec errors. In the same pass, fix the parallel reset path and make `feature-start` fail honestly instead of leaving a phantom running agent session in workflow-core when startup aborts before tmux/worktree session creation completes.

## Acceptance Criteria

- [ ] `stageAndCommitSpecMove` (or equivalent shared helper) records source deletion for tracked spec moves, but does **not** pass `fromPath` to Git staging/commit commands when that source path was never tracked.
- [ ] `feature-prioritise` succeeds for a normal freshly created feature spec that has never been committed, and its auto-commit records the backlog spec without a fatal pathspec error.
- [ ] `feature-start` succeeds for the normal flow `feature-create -> feature-prioritise -> feature-start <id> <agent>` when the spec was never manually committed between steps.
- [ ] If worktree startup still fails after workflow-core has recorded `feature.started`, the command exits non-zero and does not leave the dashboard showing a fake live agent session with no tmux session behind it.
- [ ] Reset / move-back-to-backlog paths do not have the same untracked-rename failure mode; they use the shared guarded helper or equivalent tracked-source logic.
- [ ] Automated coverage exists for both tracked and never-tracked source-path lifecycle moves, including the normal operator path through `feature-create`, `feature-prioritise`, and `feature-start`.
- [ ] The root-cause note and any relevant docs are updated if implementation details or operator guidance materially change.

## Validation
```bash
npm run test:core
node tests/integration/lifecycle-source-deletion.test.js
node tests/integration/prioritise-dep-validate.test.js
```

## Technical Approach

1. Update [`lib/git-staging.js`](/Users/jviner/src/aigon/lib/git-staging.js) so spec-move staging can distinguish:
   - tracked source path: stage/commit `fromPath` + `toPath` + extras
   - never-tracked source path: stage/commit `toPath` + extras only
2. Reuse or mirror the existing `isGitTracked` logic in [`lib/entity.js`](/Users/jviner/src/aigon/lib/entity.js:78) rather than inventing a weaker heuristic.
3. Route all relevant lifecycle move producers through the guarded helper, including reset logic that still uses raw `git add -- source target`.
4. Fix `feature-start` failure handling so a worktree-mode commit/startup failure returns non-zero and does not silently present a successful action to the dashboard.
5. Add regression coverage for:
   - tracked rename move still records source deletion
   - untracked create/prioritise/start path succeeds
   - reset/unprioritise path does not trip over an untracked source
   - failure handling does not leave a phantom running session
6. Keep the fix narrowly scoped to lifecycle staging and startup failure semantics. Do not mix it with broader workflow-core refactors.

Key files:

- [`lib/git-staging.js`](/Users/jviner/src/aigon/lib/git-staging.js)
- [`lib/entity.js`](/Users/jviner/src/aigon/lib/entity.js)
- [`lib/feature-start.js`](/Users/jviner/src/aigon/lib/feature-start.js)
- [`lib/commands/entity-commands.js`](/Users/jviner/src/aigon/lib/commands/entity-commands.js)
- [`tests/integration/lifecycle-source-deletion.test.js`](/Users/jviner/src/aigon/tests/integration/lifecycle-source-deletion.test.js)
- [`tests/integration/prioritise-dep-validate.test.js`](/Users/jviner/src/aigon/tests/integration/prioritise-dep-validate.test.js)

## Out of Scope

- Changing tmux session naming, AgentSession domain design, or dashboard action semantics beyond making the failure state truthful
- Reworking the broader feature-start / workflow-core start sequence unless required to make the failure path correct
- Cleaning up unrelated dirty-worktree or install-manifest churn in the repo

## Open Questions

- On a post-`feature.started` startup failure, should `feature-start` append a compensating workflow event, or is a hard non-zero exit plus no session-sidecar/state update enough for now?
- Should prioritise continue to warn-and-proceed on auto-commit failure once the shared helper is fixed, or should that become a hard failure for newly assigned IDs as well?

## Related

- Root cause note: [feature-558-start-regression-root-cause.md](/Users/jviner/src/aigon/docs/reports/feature-558-start-regression-root-cause.md)
- Triggering entity: [feature-558-dependency-triage-2026-w25.md](/Users/jviner/src/aigon/docs/specs/features/03-in-progress/feature-558-dependency-triage-2026-w25.md)
