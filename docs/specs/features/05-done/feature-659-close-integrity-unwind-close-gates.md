---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T12:12:54.862Z", actor: "cli/feature-prioritise" }
---

# Feature: close-integrity-unwind-close-gates

## Summary

The close-integrity set made `feature-close` much safer, but the combined policy has overcorrected and damaged Aigon's core loop: agents finish work, then close becomes a separate compliance project. This feature rebalances close around throughput. Review escalations, pre-authorisation validation, and post-merge verification remain visible audit signals, but they stop blocking close by default. Criteria attestation is removed outright, not demoted: self-attestation is structurally low-signal (the implementing agent grades its own homework), and the check it approximates — does the diff satisfy the acceptance criteria — already exists in stronger form in the review/eval step performed by a different agent. Only mechanical close failures should hard-stop the pipeline: invalid workflow state, missing branch/worktree, merge conflicts, failed security scans, git/push failures, and operator-explicit strict gates. To keep the one thing F644 got right — detection of a red default branch — advisory post-merge failures aggregate into a single persistent repo-level "main is red" condition instead of scattering per-feature warnings across closed cards. This builds on commit `d8b668906`, which already made missing criteria attestation advisory, and completes the unwind across the rest of the close-integrity stack — including deleting the attestation capability entirely.

This is not a blind revert. The local workflow log supports the diagnosis: since `2026-07-08T00:00:00Z`, 26 features had relevant close events; there were 18 close-gate failures and 9 close-recovery entries, with 12 `post-merge-gate` failures and 6 `criteria-attestation` failures. F650 and F654 both hit criteria-attestation recovery loops; F645/F646/F647/F651/F652 hit post-merge `npm run test:core` recovery loops; F656 shows approved work still carrying an open escalation that kept the dashboard in a contradictory blocked state. These are exactly the close-integrity additions, not unrelated close regressions.

## User Stories

- [ ] As an operator, feature close returns to being the normal end of an autonomous feature, not a manual audit workflow that routinely strands completed work.
- [ ] As an operator, I still see escalation, preauth, and post-merge issues clearly after close, but the default action is to keep the feature pipeline moving.
- [ ] As an implementing agent, I no longer maintain a `## Criteria Attestation` ledger in the implementation log; acceptance criteria are verified by the review/eval step, not by self-report.
- [ ] As an operator with a stricter repo, I can opt individual close-integrity checks back into hard-blocking behavior through explicit config.
- [ ] As an autonomous conductor, advisory close-integrity findings do not halt a feature set unless the operator configured that finding type as blocking.

## Acceptance Criteria

- [ ] Introduce one central close-integrity policy resolver, for example `lib/close-integrity-policy.js`, used by `feature-close`, AutoConductor, set conductor, dashboard actions/readiness, and tests. Do not leave each gate with its own private idea of blocking vs advisory.
- [ ] Default policy is throughput-first:
  - review `ESCALATE:*` markers: advisory unless strict mode is configured
  - pre-authorisation footer mismatches: advisory unless strict mode is configured
  - post-merge gate failures: advisory unless strict mode is configured
- [ ] Add explicit config for repos that want stricter behavior. The exact shape is implementation-defined, but it must be clear and composable, e.g. `featureClose.integrityPolicy: "advisory" | "blocking"` plus per-gate overrides, or `featureClose.blockingGates: ["post-merge-gate"]`. Existing `featureClose.postMergeGate` may still name the command to run; the new policy decides whether failure blocks close.
- [ ] Preserve hard stops for close failures that are not policy findings: invalid workflow transition, branch/worktree resolution failure, merge conflict, failed security scan, git command failure, push failure when currently fatal, and operator-explicit strict gates.
- [ ] Criteria attestation (F647) is removed entirely — no advisory mode, no strict mode, the capability is gone:
  - Delete `lib/criteria-attestation.js`, the `runCriteriaAttestationPhase` call in `lib/feature-close.js`, and the `--no-verify-criteria` flag (accepting it as a deprecated no-op with a notice is acceptable for one release).
  - Delete the `## Criteria Attestation` instructions from `templates/generic/commands/feature-do.md` and any other agent-facing templates; agents stop maintaining the ledger.
  - Remove attestation surfaces from the dashboard (`templates/dashboard/js/detail-tabs.js`, `drawer.css`, `lib/dashboard-detail.js`) and from `feature-status` / close-readiness / close-gate-predicate outputs.
  - Remove attestation event handling from `lib/workflow-core/engine.js` / `projector.js`; the projector must tolerate historical `feature.criteria_attested` / attestation-gate events in existing event logs without crashing (ignore, don't replay into state).
  - Delete `tests/integration/feature-close-criteria-attestation.test.js`; replace with a small test asserting close ignores `## Criteria Attestation` sections and historical attestation events.
  - Existing `## Criteria Attestation` sections in old implementation logs are inert prose — no cleanup migration needed for the logs themselves.
- [ ] `runEscalationCloseGuard` changes from unconditional hard block to policy-aware behavior. In advisory mode, open escalations are recorded and shown, but close continues. In blocking mode, current disposition commands and messages still work.
- [ ] Pre-authorisation validation becomes policy-aware. In advisory mode, unmatched footers print a loud warning and record an audit event, but do not enter `close_recovery_in_progress`. In blocking mode, the current `preauth-validation` recovery behavior is preserved.
- [ ] Post-merge gate becomes policy-aware. In advisory mode, the gate still runs when configured, writes the full log and a bounded event tail, but close proceeds and records an advisory event instead of `feature.close_gate_failed`/`close_recovery_in_progress`, and raises/updates the repo-level red-main condition (next criterion). In blocking mode, the current F644 behavior is preserved.
- [ ] Advisory post-merge gate failures aggregate into a single repo-level "main is red" condition, not just per-feature advisory events. Rationale: "gate fails on merged main" is a fact about the repo, not the feature that merged last; per-feature advisory badges land on closed cards and leave the active view (incident evidence: F617's 13:27 lint failure was identical to F645's 13:29 failure and was still unfixed at F617's 21:56 retry — one root cause, three blocked closes, 8.5 hours undetected as a single problem).
  - The condition records the gate command, the merged commit sha, the first-seen feature ID and timestamp, and the gate log path.
  - It is deduplicated and persistent: subsequent advisory failures update the existing condition (latest sha/log, first-seen preserved); it survives features closing and moving to done.
  - It surfaces where the operator already looks: a prominent dashboard banner and an `aigon board` header line, each pointing at the gate log. The dashboard renders it read-only — clearing happens via gate runs or CLI, never from the dashboard.
  - It clears automatically when a later post-merge gate run passes on main, and can be re-checked manually (gate re-run command or `aigon doctor`).
  - Optional config (off by default): the set conductor / AutoConductor pause starting *new* sets while main is red. This never blocks a feature close — the enforcement point is starting new work on a broken base, so the F644 close pile-up cannot recur.
- [ ] Add a migration/doctor repair for stale `close_recovery_in_progress` snapshots caused only by removed or now-advisory gate kinds (`criteria-attestation`, and any other gate made advisory by the current config). The repair returns the feature to `ready` or resumes close as appropriate without requiring manual event surgery.
- [ ] Update set conductor and AutoConductor so advisory findings do not pause or fail a set. Blocking policy findings still pause with the existing reason vocabulary.
- [ ] Revise or supersede F658 (`close-readiness-single-blocker-ux`) so it no longer models missing criteria attestation, advisory escalations, advisory preauth mismatches, or advisory post-merge gate failures as close blockers. If F658 remains active, update its spec before implementation continues.
- [ ] Dashboard surfaces advisory findings as warnings/audit badges, not primary blockers, when policy says they are advisory. "Ready to close" must mean the actual close command will not be blocked by advisory findings.
- [ ] Documentation updates:
  - `templates/docs/development_workflow.md` explains advisory default vs strict opt-in without target-repo package-manager assumptions, and drops all `## Criteria Attestation` instructions.
  - `AGENTS.md` close-integrity notes describe the new default policy and the config escape to strict mode.
  - `docs/architecture.md` reflects that `feature.close_gate_failed` is for blocking gate failures, while advisory findings use non-blocking audit events.
- [ ] Tests update the old close-integrity expectations:
  - criteria attestation is gone: close never parses `## Criteria Attestation` and emits no attestation events
  - open review escalation does not block close by default
  - unmatched preauth footer does not block close by default
  - post-merge gate failure does not block close by default
  - each gate still blocks when strict policy is configured
  - stale criteria-attestation close recovery is repaired
  - advisory post-merge failure raises the red-main condition; a second failure updates (not duplicates) it; a passing gate run clears it; feature close proceeds in all three states
- [ ] Add a regression fixture based on the local incident pattern: a feature with an approved review escalation and no `## Criteria Attestation` section should still be closable in default advisory policy, while the same fixture blocks under strict escalation policy.

## Validation

```bash
node -c lib/feature-close.js
node -c lib/feature-escalation.js
node -c lib/spec-preauth.js
test ! -f lib/criteria-attestation.js
grep -ri "criteria attestation" templates/generic/commands/ && exit 1 || true
npm run test:core
```

## Pre-authorised

- May update tests that currently assert hard blocking for F645/F646/F644 to assert advisory-by-default plus strict-mode coverage instead.
- May delete the F647 criteria-attestation module, tests, dashboard surfaces, and template instructions outright.
- May update or supersede F658 acceptance criteria where they conflict with advisory close policy.

## Technical Approach

Start by extracting policy decisions, not by deleting gate code. The old implementation is useful as strict-mode behavior and as an audit producer. The first change should be a small, well-tested resolver that answers questions like:

```js
isCloseFindingBlocking(policy, 'review-escalation')
isCloseFindingBlocking(policy, 'preauth-validation')
isCloseFindingBlocking(policy, 'post-merge-gate')
```

Criteria attestation is not a policy finding — it has no advisory or strict mode; it is deleted (see its acceptance criterion).

Then wire the close phases through it:

- `lib/feature-close.js`: keep phase ordering, but turn preauth/post-merge failures into advisory events and warnings when policy says advisory. Only call `record*Failure` and enter `close_recovery_in_progress` in blocking mode. Delete the criteria attestation phase.
- `lib/feature-escalation.js`: make `runEscalationCloseGuard` policy-aware and rename it if needed; in advisory mode it returns `{ ok: true, advisory: true, open }`.
- `lib/criteria-attestation.js`: delete the module and all call sites (close phase, feature-status, close-readiness, dashboard detail, agent templates, tests) per the removal acceptance criterion.
- `lib/set-conductor.js` and `lib/feature-autonomous.js`: consume the same resolver so set/autonomous behavior matches CLI close.
- `lib/workflow-core/engine.js` and `lib/workflow-core/projector.js`: add or reuse non-blocking advisory event projection. Avoid overloading `feature.close_gate_failed` for findings that no longer fail close.
- `lib/migration.js` / doctor repair: clear stale advisory-only close recovery states left by the original strict criteria/preauth/post-merge behavior.
- Red-main condition: store as small repo-level state (e.g. under `.aigon/state/`, alongside the existing `close-gates/` logs), written by the advisory post-merge path and cleared by a passing run. Expose via `/api/status` for the dashboard banner — remember new status fields must be added to `computeStatusFingerprint` (`lib/dashboard-status-version.js`) or the banner won't repaint. `aigon board` reads the same state for its header line.

Keep the implementation boring: policy-first, minimal behavior branches, focused regression tests for default/advisory and strict/blocking modes.

## Dependencies

- Builds on `d8b668906` (`fix: unblock feature close and repair spec-review lifecycle drift`).
- Supersedes or revises F658 assumptions around close blockers.
- Related to F644, F645, F646, F647, and F432.

## Out of Scope

- Removing the escalation/preauth/post-merge audit surfaces (criteria attestation is the deliberate exception — it is removed by this feature).
- Removing security scans or merge-conflict protection.
- Rewriting the dashboard card system beyond policy-driven blocker/advisory rendering.
- Changing research close.
- Adding remote CI integration for post-merge gates.

## Open Questions

- Should strict mode be a single boolean/preset or a per-gate list? Recommendation: support a preset plus per-gate override so the default is simple and strict repos can be precise.
- Should this repo's own `.aigon/config.json` keep running `npm run test:core` as an advisory post-merge gate, or should it temporarily disable the gate entirely until the close queue is healthy? Recommendation: advisory gate in code, and consider disabling locally as an operator config decision if throughput remains blocked.
- Should advisory `ESCALATE:security` remain hard-blocking even in default mode? Recommendation: not in v1 unless it overlaps with the existing security scan. The scanner is the hard security gate; review escalation is an operator signal.

## Related

- Prior work: F644 post-merge gate, F645 preauth validation, F646 review escalation state, F647 criteria attestation, F432 close recovery, F658 close-readiness single-blocker UX.
- Incident evidence: workflow events for F645/F646/F647/F650/F651/F652/F654/F656 on 2026-07-08 and 2026-07-09.
- Emergency mitigation already landed: `d8b668906` demoted missing criteria attestation to advisory and clears stale criteria-attestation recovery on retry.
