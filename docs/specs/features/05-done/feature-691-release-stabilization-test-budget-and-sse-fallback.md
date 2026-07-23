---
aigon_id: F691
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
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-23T22:40:06.392Z", actor: "cli/feature-prioritise" }
---

# Feature: release-stabilization-test-budget-and-sse-fallback

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Restore release readiness by adopting the existing uncommitted dashboard
spec-cycle session-liveness work into a tracked feature, reducing duplicated or
obsolete automated-test code below the repository's hard LOC ceiling without
raising it, and repairing the reproducible Playwright failure for the
SSE-to-poll fallback path.

## User Stories
- [ ] As an operator, I can still inspect a live spec-review or spec-revise
      session when durable workflow state has already returned to a resting
      inbox/backlog state.
- [ ] As a maintainer, the release gate enforces a meaningful test suite that
      fits within its approved LOC budget rather than carrying duplicate or
      obsolete coverage.
- [ ] As a dashboard user, blocking SSE still leaves periodic status polling
      functional and the dashboard usable.

## Acceptance Criteria
- [ ] The current `lib/dashboard-status-helpers.js` and
      `lib/workflow-read-model.js` changes are reviewed, retained only where
      justified, and covered by focused regression assertions in
      `tests/integration/dashboard-review-statuses.test.js`.
- [ ] Live spec-review and spec-revise tmux sessions appear in the read model
      for inbox/backlog entities even when snapshot reviewer/checker arrays are
      absent or empty; durable rows are not duplicated.
- [ ] Test code counted by `scripts/check-test-budget.sh` is at or below 17,225
      LOC with no ceiling increase. Deleting whole test files and consolidating
      overlapping cases is explicitly authorised where retained tests already
      pin the same public behavior.
- [ ] Every deleted or consolidated test is justified in the implementation log
      by overlap, obsolete behavior, or private-implementation coupling; no
      production behavior is removed merely to make tests pass.
- [ ] The Playwright test for blocked SSE and polling fallback passes
      reproducibly and asserts the current user-visible contract rather than a
      stale presentation detail.
- [ ] `npm run test:iterate`, the isolated SSE Playwright file, and
      `bash scripts/check-test-budget.sh` pass before submission.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm run test:iterate
MOCK_DELAY=fast npx playwright test tests/dashboard-e2e/sse-status-push.spec.js --config tests/dashboard-e2e/playwright.config.js --reporter=list
bash scripts/check-test-budget.sh
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach
- Adopt the existing live-session discovery helper and read-model augmentation,
  simplifying it if review finds duplicated state or avoidable branching.
- Inventory large and overlapping test files against current production APIs
  and runner tiers. Prefer removal of superseded files or duplicate scenarios
  over line-by-line compression. Preserve high-value lifecycle, security,
  workflow, storage, and public-contract coverage.
- Diagnose the SSE Playwright failure against the current pipeline rendering
  and fixture data. Fix production polling only if it is broken; otherwise
  update the stale assertion to target a stable visible contract.
- Do not raise the test LOC ceiling.

### Key Files

- `lib/dashboard-status-helpers.js`
- `lib/workflow-read-model.js`
- `tests/integration/dashboard-review-statuses.test.js`
- `tests/dashboard-e2e/sse-status-push.spec.js`
- Test files selected for consolidation or deletion after evidence-based review
- `scripts/check-test-budget.sh` (validation only; ceiling remains unchanged)

## Dependencies
- Existing Playwright dashboard fixture and local tmux/session test helpers.

## Out of Scope
- Raising the test budget or weakening release-gate policy.
- Redesigning the dashboard pipeline, SSE protocol, or workflow state machine.
- Publishing packages, pushing branches/tags, or closing the feature.

## Open Questions
- None. Retain or delete tests based on demonstrated coverage overlap and
  current public behavior.

## Related
- Prior work: F622 (dashboard SSE status push) and the current uncommitted
  spec-cycle session-liveness implementation.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
