---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T12:12:54.862Z", actor: "cli/feature-prioritise" }
---

# Feature: close-integrity-unwind-close-gates

## Summary

The close-integrity set made `feature-close` much safer, but the combined policy has overcorrected and damaged Aigon's core loop: agents finish work, then close becomes a separate compliance project. This feature rebalances close around throughput. Criteria attestation, review escalations, pre-authorisation validation, and post-merge verification remain visible audit signals, but they stop blocking close by default. Only mechanical close failures should hard-stop the pipeline: invalid workflow state, missing branch/worktree, merge conflicts, failed security scans, git/push failures, and operator-explicit strict gates. This builds on commit `d8b668906`, which already made missing criteria attestation advisory, and completes the unwind across the rest of the close-integrity stack.

This is not a blind revert. The local workflow log supports the diagnosis: since `2026-07-08T00:00:00Z`, 26 features had relevant close events; there were 18 close-gate failures and 9 close-recovery entries, with 12 `post-merge-gate` failures and 6 `criteria-attestation` failures. F650 and F654 both hit criteria-attestation recovery loops; F645/F646/F647/F651/F652 hit post-merge `npm run test:core` recovery loops; F656 shows approved work still carrying an open escalation that kept the dashboard in a contradictory blocked state. These are exactly the close-integrity additions, not unrelated close regressions.

## User Stories

- [ ] As an operator, feature close returns to being the normal end of an autonomous feature, not a manual audit workflow that routinely strands completed work.
- [ ] As an operator, I still see criteria, escalation, preauth, and post-merge issues clearly after close, but the default action is to keep the feature pipeline moving.
- [ ] As an operator with a stricter repo, I can opt individual close-integrity checks back into hard-blocking behavior through explicit config.
- [ ] As an autonomous conductor, advisory close-integrity findings do not halt a feature set unless the operator configured that finding type as blocking.

## Acceptance Criteria

- [ ] Introduce one central close-integrity policy resolver, for example `lib/close-integrity-policy.js`, used by `feature-close`, AutoConductor, set conductor, dashboard actions/readiness, and tests. Do not leave each gate with its own private idea of blocking vs advisory.
- [ ] Default policy is throughput-first:
  - criteria attestation: advisory
  - criteria `deferred` / `dropped`: advisory, no default `review.escalation_raised` close blocker
  - review `ESCALATE:*` markers: advisory unless strict mode is configured
  - pre-authorisation footer mismatches: advisory unless strict mode is configured
  - post-merge gate failures: advisory unless strict mode is configured
- [ ] Add explicit config for repos that want stricter behavior. The exact shape is implementation-defined, but it must be clear and composable, e.g. `featureClose.integrityPolicy: "advisory" | "blocking"` plus per-gate overrides, or `featureClose.blockingGates: ["post-merge-gate"]`. Existing `featureClose.postMergeGate` may still name the command to run; the new policy decides whether failure blocks close.
- [ ] Preserve hard stops for close failures that are not policy findings: invalid workflow transition, branch/worktree resolution failure, merge conflict, failed security scan, git command failure, push failure when currently fatal, and operator-explicit strict gates.
- [ ] `runCriteriaAttestationPhase` remains advisory as in `d8b668906`, and deferred criteria no longer create blocking review escalations by default. If strict criteria mode is configured, the old escalation behavior may be restored deliberately.
- [ ] `runEscalationCloseGuard` changes from unconditional hard block to policy-aware behavior. In advisory mode, open escalations are recorded and shown, but close continues. In blocking mode, current disposition commands and messages still work.
- [ ] Pre-authorisation validation becomes policy-aware. In advisory mode, unmatched footers print a loud warning and record an audit event, but do not enter `close_recovery_in_progress`. In blocking mode, the current `preauth-validation` recovery behavior is preserved.
- [ ] Post-merge gate becomes policy-aware. In advisory mode, the gate still runs when configured, writes the full log and a bounded event tail, but close proceeds and records an advisory event instead of `feature.close_gate_failed`/`close_recovery_in_progress`. In blocking mode, the current F644 behavior is preserved.
- [ ] Add a migration/doctor repair for stale `close_recovery_in_progress` snapshots caused only by now-advisory gate kinds (`criteria-attestation`, and any other gate made advisory by the current config). The repair returns the feature to `ready` or resumes close as appropriate without requiring manual event surgery.
- [ ] Update set conductor and AutoConductor so advisory findings do not pause or fail a set. Blocking policy findings still pause with the existing reason vocabulary.
- [ ] Revise or supersede F658 (`close-readiness-single-blocker-ux`) so it no longer models missing criteria attestation, advisory escalations, advisory preauth mismatches, or advisory post-merge gate failures as close blockers. If F658 remains active, update its spec before implementation continues.
- [ ] Dashboard surfaces advisory findings as warnings/audit badges, not primary blockers, when policy says they are advisory. "Ready to close" must mean the actual close command will not be blocked by advisory findings.
- [ ] Documentation updates:
  - `templates/docs/development_workflow.md` explains advisory default vs strict opt-in without target-repo package-manager assumptions.
  - `AGENTS.md` close-integrity notes describe the new default policy and the config escape to strict mode.
  - `docs/architecture.md` reflects that `feature.close_gate_failed` is for blocking gate failures, while advisory findings use non-blocking audit events.
- [ ] Tests update the old close-integrity expectations:
  - missing criteria remains advisory
  - deferred criteria does not block close by default
  - open review escalation does not block close by default
  - unmatched preauth footer does not block close by default
  - post-merge gate failure does not block close by default
  - each gate still blocks when strict policy is configured
  - stale criteria-attestation close recovery is repaired
- [ ] Add a regression fixture based on the local incident pattern: a feature with an approved review escalation plus incomplete criteria should still be closable in default advisory policy, while the same fixture blocks under strict policy.

## Validation

```bash
node -c lib/feature-close.js
node -c lib/feature-escalation.js
node -c lib/criteria-attestation.js
node -c lib/spec-preauth.js
npm run test:core
```

## Pre-authorised

- May update tests that currently assert hard blocking for F645/F646/F647/F644 to assert advisory-by-default plus strict-mode coverage instead.
- May update or supersede F658 acceptance criteria where they conflict with advisory close policy.

## Technical Approach

Start by extracting policy decisions, not by deleting gate code. The old implementation is useful as strict-mode behavior and as an audit producer. The first change should be a small, well-tested resolver that answers questions like:

```js
isCloseFindingBlocking(policy, 'review-escalation')
isCloseFindingBlocking(policy, 'criteria-attestation')
isCloseFindingBlocking(policy, 'preauth-validation')
isCloseFindingBlocking(policy, 'post-merge-gate')
```

Then wire the close phases through it:

- `lib/feature-close.js`: keep phase ordering, but turn criteria/preauth/post-merge failures into advisory events and warnings when policy says advisory. Only call `record*Failure` and enter `close_recovery_in_progress` in blocking mode.
- `lib/feature-escalation.js`: make `runEscalationCloseGuard` policy-aware and rename it if needed; in advisory mode it returns `{ ok: true, advisory: true, open }`.
- `lib/criteria-attestation.js`: stop creating blocking `review.escalation_raised` events for deferred criteria by default. Prefer a non-blocking audit event or `feature.criteria_attested` payload.
- `lib/set-conductor.js` and `lib/feature-autonomous.js`: consume the same resolver so set/autonomous behavior matches CLI close.
- `lib/workflow-core/engine.js` and `lib/workflow-core/projector.js`: add or reuse non-blocking advisory event projection. Avoid overloading `feature.close_gate_failed` for findings that no longer fail close.
- `lib/migration.js` / doctor repair: clear stale advisory-only close recovery states left by the original strict criteria/preauth/post-merge behavior.

Keep the implementation boring: policy-first, minimal behavior branches, focused regression tests for default/advisory and strict/blocking modes.

## Dependencies

- Builds on `d8b668906` (`fix: unblock feature close and repair spec-review lifecycle drift`).
- Supersedes or revises F658 assumptions around close blockers.
- Related to F644, F645, F646, F647, and F432.

## Out of Scope

- Removing close-integrity audit surfaces entirely.
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
