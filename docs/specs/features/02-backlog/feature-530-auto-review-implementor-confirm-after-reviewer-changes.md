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
- [ ] In solo autonomous mode, `review-complete --approve` does not immediately make the feature close-eligible when the review produced implementor-visible output that requires acknowledgement.
- [ ] Reviewer-authored `fix(review):` commits on the feature branch always trigger an implementor follow-up step before close, even when the reviewer signaled `--approve`.
- [ ] Review-log escalations recorded in the `## Code Review` section also trigger the implementor follow-up step before close. A clean review log with `Escalated Issues: None` does not trigger by escalation alone.
- [ ] The implementor follow-up step reuses the existing autonomous prompt-injection path and waits for an implementor completion signal before `feature-close`.
- [ ] The injected prompt text for this path is framed as an implementor review/disposition of reviewer output (`accept`, `revert`, or `modify`) rather than as "the reviewer requested revision."
- [ ] A truly clean approved review remains close-eligible: no reviewer-authored branch changes, no escalated issues requiring acknowledgement, and no extra implementor step.
- [ ] Fleet autonomous mode behavior is unchanged by this feature.
- [ ] Feature 528's event/log shape is covered by a regression test: review approved, reviewer committed `fix(review): ...`, autonomous close must not proceed until the implementor disposition step completes.

## Validation
```bash
node -c lib/feature-autonomous.js
node -c lib/agent-prompt-resolver.js
npm test
```

## Technical Approach
Keep the existing engine states and `review-complete --approve|--request-revision` CLI contract. The change is in the autonomous close gate and in how the system derives "implementor acknowledgement required."

### 1. Derive "implementor acknowledgement required" from review output, not reviewer verdict

Introduce a helper on the autonomous/read side that answers whether a completed review produced output the implementor must inspect before close. The initial rule for this feature:

- reviewer-authored `fix(review):` commits on the feature branch since the review started => require implementor acknowledgement
- review log `## Code Review` section contains any `ESCALATE:` entry other than an explicit `None` => require implementor acknowledgement

The helper should be deterministic from repo/workflow state and should not depend on whether the reviewer chose `--approve` or `--request-revision`.

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

In solo autonomous close flow:

- `review-complete --approve` with no implementor-visible reviewer output remains immediate close-eligible
- `review-complete --approve` with reviewer commits/escalations is not close-eligible until the implementor follow-up completes
- `review-complete --request-revision` remains not close-eligible until implementor follow-up completes

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
- What is the most robust implementation for detecting reviewer-authored commits during the review window: commit-message convention alone, author/agent metadata, or diffing against the commit present at `feature.code_review.started`? Recommendation: use a helper that prefers durable git evidence over prompt conventions alone.
- Should any non-`None` escalation trigger acknowledgement, or only specific escalation categories? Recommendation: any `ESCALATE:` entry should trigger it for this first patch; narrower semantics can come later if needed.
- Should the implementor completion signal remain `revision-complete`, or should the injected follow-up rely on the more generic "review addressed" path already tolerated by AutoConductor? Recommendation: keep the existing completion signal path to minimize surface area.

## Related
- Research: —
- Incident: Feature 528 — approved autonomous review merged reviewer-authored `fix(review):` changes without an implementor disposition step
- Prior features: F514 post-review-feedback-injection, F342 review-cycle-redesign-2-code-states, F501 remove-phantom-submitted-state-and-fix-review-complete-cli
