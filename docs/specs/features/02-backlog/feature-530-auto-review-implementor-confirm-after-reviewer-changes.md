---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T10:57:47.834Z", actor: "cli/feature-prioritise" }
---

# Feature: auto-review-implementor-confirm-after-reviewer-changes

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
When a solo autonomous code review produces reviewer-authored output that the implementor has a right to inspect, Aigon must pause before close and hand control back to the implementing agent. Today the autonomous loop closes immediately after `review-complete --approve`, even when the reviewer committed `fix(review): ...` changes; feature 528 demonstrated that this lets reviewer-authored branch changes merge without any implementor accept/revert/modify step. This feature keeps the current review states and verdict flags, but changes the close gate: approved reviews that produced reviewer output requiring implementor acknowledgement must inject a post-review disposition step and wait for the implementor's completion signal before `feature-close`.

## User Stories
- [ ] As an implementing agent, when a reviewer changes my branch in autonomous mode, I get a turn to accept, revert, or modify those review changes before the feature closes.
- [ ] As an operator, I want autonomous close to distinguish between "reviewer finished reviewing" and "implementor has acknowledged reviewer output," so an approval verdict alone cannot bypass the implementor.
- [ ] As a reviewer, I can still use `review-complete --approve` for a review that is otherwise done, without that flag also deciding whether the implementor gets a follow-up step.

## Acceptance Criteria
- [ ] In solo autonomous mode, `review-complete --approve` does not immediately make the feature close-eligible when the detection rule below fires.
- [ ] Detection rule (deterministic): the implementor follow-up is required when either (a) at least one commit exists on the feature branch with author/timestamp after `snapshot.codeReview.reviewStartedAt` whose author is not the implementor of record, OR (b) the spec's `## Code Review` section contains any `ESCALATE:` line (case-sensitive prefix); "Escalated Issues: None" or absence of any `ESCALATE:` line does not trigger.
- [ ] When the detection rule fires, AutoConductor reuses the existing post-review prompt-injection path into the implementor's tmux session and gates `feature-close` on the same completion signal already accepted by that path (`feedback-addressed` / `revision-complete`, or `engineRevisionComplete`).
- [ ] The injected prompt text for this path is framed as an implementor disposition of reviewer output (`accept`, `revert`, or `modify`) rather than "the reviewer requested revision."
- [ ] The engine's `codeReview.requestRevision` flag is left untouched by this feature; gating is driven entirely by AutoConductor's detection helper, not by mutating review state.
- [ ] A clean approved review (no post-`reviewStartedAt` non-implementor commits, no `ESCALATE:` entries) closes directly with no extra implementor step — current behavior preserved.
- [ ] If the implementor session is gone when injection time comes, AutoConductor falls back to the existing "implementation session not found" branch (treats follow-up as addressed) and logs the bypass; it does not block close indefinitely.
- [ ] Implementor disposition step honors the existing `MAX_FEEDBACK_POLLS` timeout; on timeout, AutoConductor exits non-zero with `reason: 'feedback-timeout'` (no new failure mode).
- [ ] Fleet autonomous mode behavior is unchanged by this feature.
- [ ] Regression test covers feature 528's exact shape: ready → review-started → reviewer `fix(review): ...` commit → `review-complete --approve` → AutoConductor must inject the disposition prompt and must not call `feature-close` until the implementor signals.
- [ ] Positive test covers the clean-review path: `--approve` with no reviewer commits and no `ESCALATE:` entries closes immediately, no injection.

## Validation
```bash
node -c lib/feature-autonomous.js
# Unit-test the new helper + the close-gating branch:
npm run test:iterate -- --testPathPattern='feature-autonomous|code-review'
# Full non-browser gate before close:
npm run test:core
```
The regression test (AC #9) and positive test (AC #10) live under `tests/integration/` alongside other AutoConductor tests; use the existing fixture pattern for `.aigon/workflows/features/<id>/snapshot.json` rather than spinning up a real tmux session.

## Technical Approach
Keep the existing engine states and `review-complete --approve|--request-revision` CLI contract. The change is in the autonomous close gate and in how the system derives "implementor acknowledgement required."

### 1. Derive "implementor acknowledgement required" from review output, not reviewer verdict

Add a helper `requiresImplementorDisposition(snapshot, mainRepo, featureNum, implAgentId)` in `lib/feature-autonomous.js` (or a sibling file under `lib/` if it grows; keep it co-located with the AutoConductor for the first patch). It returns boolean and is deterministic from durable state:

- Git evidence (preferred — does not rely on commit-message convention): run `git log --since=<snapshot.codeReview.reviewStartedAt> --format='%H %an %ae'` against the feature worktree's branch and return true if any commit's author email/agent ID is not the implementor of record. This catches `fix(review): ...`, `docs(review): ...`, and anything else the reviewer authored, by author rather than subject prefix.
- Log evidence: scan the spec's `## Code Review` section for any line matching `/^[-*\s]*\*?\*?ESCALATE:/m`. Presence => true. "Escalated Issues: None" or absence of any `ESCALATE:` line => no contribution.

The helper does not consult `codeReview.requestRevision` and works the same for `--approve` and `--request-revision`. It must be unit-testable in isolation given a snapshot, a tmp repo, and a spec file path.

### 2. Reuse the existing post-review injection path

Solo AutoConductor already knows how to inject a prompt into the implementor's live tmux session and wait for a completion signal. Reuse that path for two cases:

- reviewer requested revision (`--request-revision`) — existing behavior
- reviewer approved but implementor acknowledgement is required because reviewer output exists

This keeps the implementation small and avoids adding a new workflow-core state in this feature.

### 3. Differentiate the injected prompt copy

The implementor prompt for the new approved-but-ack-required path should make the authority explicit:

- the reviewer is done
- review changes/notes exist
- the implementor must inspect them and choose accept / revert / modify
- signal completion when that disposition is done

This is a wording/behavior distinction, not a new lifecycle state.

### 4. Close gating

Concretely, replace the short-circuit at `lib/feature-autonomous.js:472-480` (the `reviewApprovedNoRevision` branch). The new branch:

1. Compute `requiresImplementorDisposition(...)`.
2. If false: keep current behavior — set `feedbackInjected=true`, `feedbackAddressed=true`, continue to close.
3. If true: fall through to the existing injection branch (lines 481-503), but use the new disposition prompt copy from §3.

So the close matrix becomes:

| Verdict | Disposition required? | Result |
|---------|----------------------|--------|
| `--approve` | no | close immediately (current behavior) |
| `--approve` | yes (this feature) | inject disposition prompt, gate close on implementor signal |
| `--request-revision` | n/a | inject revision prompt, gate close on implementor signal (current behavior) |

### 5. Tests

Add a regression test around the exact failure class from feature 528:

- implementor signals ready
- review starts
- reviewer produces a `fix(review): ...` commit and a `docs(review): ...` log entry
- reviewer signals `review-complete --approve`
- AutoConductor must inject the implementor follow-up and must not call `feature-close` until that follow-up completes

Also add positive coverage for the clean-review case where `--approve` plus no reviewer output still closes directly.

## Dependencies
- None hard. Builds on the existing post-review injection behavior from feature 514 and the current code-review state model.

## Out of Scope
- Introducing a brand-new workflow-core state for "implementor review of reviewer changes"
- Changing fleet autonomous review/eval behavior
- Replacing `review-complete --approve|--request-revision` with a different CLI verdict API
- Redesigning the review log schema beyond what is needed to detect escalations reliably
- Retrofitting or reopening already-closed historical features

## Open Questions
- Resolved by AC #2 and §1: detection uses git author evidence against `snapshot.codeReview.reviewStartedAt` plus an `ESCALATE:` scan of the spec's `## Code Review` section. Any narrower escalation semantics can come in a follow-up.
- Resolved by AC #3 and §3: keep the existing completion signal set (`feedback-addressed` / `revision-complete` / `engineRevisionComplete`); the prompt copy differs but the signal does not.
- Open: should the dashboard read-model expose a distinct "awaiting implementor disposition" status (vs the existing "code revision in progress")? Out of scope for this feature unless it falls out for free; revisit if operators report confusion.

## Related
- Research: —
- Incident: Feature 528 — approved autonomous review merged reviewer-authored `fix(review):` changes without an implementor disposition step
- Prior features: F514 post-review-feedback-injection, F342 review-cycle-redesign-2-code-states, F501 remove-phantom-submitted-state-and-fix-review-complete-cli
