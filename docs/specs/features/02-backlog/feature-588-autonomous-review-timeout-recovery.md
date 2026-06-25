---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-25T01:16:06.599Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous review timeout recovery

## Summary
Make feature and set autonomous orchestration recover correctly when a review agent is delayed by a provider quota window and finishes after the AutoConductor's review wait has timed out. The workflow engine can already advance after a late `review-complete` signal, but failed feature/set conductor sidecars remain latched at stale failure states. This leaves operators with misleading recovery options, no true "resume autonomy from current workflow state" path, and in some dashboard views no visible set recovery controls. The fix should treat the workflow snapshot as authoritative, make AutoConductor restart/resume phase-aware, and reconcile stale conductor failure state instead of letting it permanently block the feature set.

## User Stories
- [ ] As an operator, when a review agent hits a token/quota window and the feature AutoConductor times out, I can resume autonomous orchestration after the reviewer recovers without rerunning completed work.
- [ ] As an operator, when a delayed review eventually records `review-complete`, the dashboard recovery recommendation reflects the feature's current workflow state rather than the older AutoConductor timeout.
- [ ] As an operator, when a set pauses because one member's feature AutoConductor timed out, I can see and use set resume/reset controls from the set header.
- [ ] As an operator, when a set resumes after a member's workflow state has advanced, the set conductor does not keep treating the member as failed solely because of stale `failed[]` state.
- [ ] As an operator, I can still take over manually, re-run review, start code revision, or close the feature when those are valid workflow actions.

## Acceptance Criteria
- [ ] Add an explicit `aigon feature-autonomous-resume <ID>` command and dashboard action for failed/stopped/quota-paused feature AutoConductors when persisted agents are available.
- [ ] `feature-autonomous-resume` restores persisted agents, review agent, eval agent, workflow slug, model overrides, effort overrides, and original `stopAfter` where present.
- [ ] Resumed autonomy honors the original `stopAfter`. For example, if the original run was `stopAfter=close`, the resumed controller continues toward close after a clean completed review; if it was `stopAfter=review`, it stops after review.
- [ ] Feature AutoConductor start/resume hydrates its internal phase flags from durable workflow state and existing feature-auto metadata instead of assuming a fresh run from implementation.
- [ ] Restarting/resuming an AutoConductor for a solo feature whose snapshot is `ready` with `codeReview.reviewCompletedAt` proceeds from the post-review phase. If the review was approved and no implementor disposition is required, the controller can proceed toward close instead of launching a fresh review.
- [ ] Restarting/resuming an AutoConductor for `code_revision_in_progress` waits for or drives the revision phase, and for `code_review_in_progress` continues waiting for review completion without losing the original review agent context.
- [ ] Review waiting emits a stale/waiting diagnostic after 6 hours, but does not hard-fail while the expected review tmux session is still alive solely because a fixed wall-clock/poll limit elapsed.
- [ ] Hard failure remains for cases where the review session exits without a workflow signal, cannot be started, or records explicit quota/failure state.
- [ ] Failed/stopped feature-auto sidecars are reconciled against newer workflow progress when building dashboard recovery DTOs. A stale `review-timeout` whose `updatedAt` predates `codeReview.reviewCompletedAt` must not recommend rerunning review as the primary path.
- [ ] Read-model reconciliation is read-only: it may change dashboard recommendations, but it must not rewrite `feature-*-auto.json` or set state files. Explicit resume/reset actions perform any needed write cleanup.
- [ ] Feature recovery operations include a real "Resume automation" operation for failed/stopped/quota-paused feature AutoConductors when persisted agents are available.
- [ ] Feature recovery operations include `feature-code-revise` when that action is valid, and continue to expose close/re-run-review/reset/open-session as appropriate.
- [ ] Set conductor resume clears stale failure markers for the member it is retrying, and removes a member from `failed[]` once that member reaches done or otherwise advances successfully.
- [ ] Set member dashboard state does not render a member as failed solely because `autoState.failed[]` contains the id when the workflow snapshot has advanced beyond the failure that created that marker.
- [ ] Set dashboard header renders `set-autonomous-resume` and `set-autonomous-reset` when `buildSetValidActions()` returns them for `paused-on-failure`.
- [ ] Regression coverage models the F576 situation: feature-auto `failed/review-timeout`, set-auto `paused-on-failure` with the feature in `failed[]`, and a newer feature snapshot where code review completed and lifecycle is `ready`.
- [ ] Existing feature review recovery, feature autonomous stop, set conductor, and workflow read-model tests continue passing.

## Validation
```bash
npm test
```

## Technical Approach
- Add explicit feature autonomous resume plumbing.
  - Add command routing for `feature-autonomous-resume <ID>`.
  - Reuse persisted `.aigon/state/feature-<id>-auto.json` inputs when CLI args are omitted.
  - Keep `feature-autonomous-start` as the normal fresh-start entry point; resume is the recovery path.
- Add phase hydration helpers in `lib/feature-autonomous.js`.
  - Read the workflow snapshot at controller startup and before each phase decision.
  - Derive `reviewTriggered`, `reviewStarted`, `feedbackInjected`, `feedbackAddressed`, `closeTriggered`, and disposition requirements from snapshot state, persisted feature-auto state, existing review sessions, and review metadata.
  - Keep the launch path compatible with fresh backlog/in-progress starts, but make failed/stopped controller resumes continue from the engine's current lifecycle.
- Change review waiting semantics.
  - Replace the fixed "120 polls means failed" behavior for live review sessions with live-session-aware waiting.
  - After 6 hours, persist/display a stale waiting diagnostic while continuing to wait if the review session is still alive.
  - Keep hard failure for cases where the review session exits without a workflow signal, cannot be started, or records explicit quota/failure state.
- Reconcile autonomous controller DTOs in `lib/workflow-read-model.js` and `lib/feature-review-recovery-dashboard-actions.js`.
  - Compare feature-auto timestamps/reasons against workflow progress timestamps such as `codeReview.reviewCompletedAt`.
  - Downgrade stale failure recommendations so "rerun review" is not primary after review already completed.
  - Add a recovery operation for resuming feature autonomy.
  - Include `feature-code-revise` in recovery tagging/operation mapping when the workflow exposes it.
- Fix set conductor state handling in `lib/set-conductor.js`.
  - On resume, remove the failed current feature from `failed[]` before retrying.
  - When a member is detected done or successfully completes, remove it from `failed[]`.
  - Before propagating a failed feature-auto result, re-check the authoritative workflow snapshot and newer timestamps so stale feature-auto failure does not pause the set again.
- Fix set dashboard rendering in `templates/dashboard/js/pipeline.js`.
  - Render relevant `validActions` from `buildSetValidActions()`, including `set-autonomous-resume`, `set-autonomous-reset`, and `set-autonomous-stop`.
  - Keep destructive confirmations routed through existing `templates/dashboard/js/actions/set-autonomous.js`.
- Add focused tests.
  - Unit/integration coverage for phase hydration and stale failure reconciliation.
  - Read-model coverage for F576-shaped feature recovery actions.
  - Set conductor coverage for clearing stale `failed[]` on resume/success.
  - Dashboard/action coverage that paused set resume/reset actions are emitted and renderable.

## Dependencies
- Existing review recovery work, especially F561/F563/F568/F569/F570 behavior around feature autonomous stop and dashboard recovery surfaces.
- Existing code paths:
  - `lib/feature-autonomous.js`
  - `lib/set-conductor.js`
  - `lib/workflow-read-model.js`
  - `lib/feature-review-recovery-dashboard-actions.js`
  - `lib/feature-autonomous-dashboard-actions.js`
  - `lib/feature-set-workflow-rules.js`
  - `templates/dashboard/js/pipeline.js`
  - `templates/dashboard/js/actions/set-autonomous.js`

## Out of Scope
- Manually editing or repairing F576 state as part of implementation.
- Changing workflow-core lifecycle event semantics unless a spec review determines a small addition is required.
- Adding provider-specific quota detection beyond existing quota/status mechanisms.
- Changing the semantics of `feature-close` merge/recovery.
- Reworking set scheduling or Pro-only scheduler behavior.

## Open Questions
- Should stale feature-auto failures that predate workflow progress display as "stale recovered failure" in diagnostics, or should the UI hide the stale failure once better actions are available?
- Should the 6-hour stale waiting diagnostic be configurable later via project config, or remain a fixed controller behavior for now?

## Related
- Incident/regression fixture: F576 `specstore-local-adapter`
- Affected set: `specstore-git-backed-storage`
- Related features: F561 autonomous review takeover; F563/F568/F569/F570 review recovery dashboard work
