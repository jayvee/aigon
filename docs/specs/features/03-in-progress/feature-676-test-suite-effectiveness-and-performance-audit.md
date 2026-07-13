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
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
---

# Feature: test-suite-effectiveness-and-performance-audit

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Audit the complete automated test suite, remove ineffective, stale, or duplicate coverage, consolidate repetitive tests, and reduce execution cost while preserving meaningful behavioral protection.

## User Stories
- [ ] As a maintainer, I want each retained test to protect a distinct behavior so failures remain actionable.
- [ ] As a contributor, I want a materially smaller and faster suite so local and release validation stays economical.

## Acceptance Criteria
- [ ] Review unit, integration, workflow-core, and dashboard browser tests for duplicated behavior, stale assumptions, weak assertions, and unnecessary setup.
- [ ] Remove or consolidate at least 10% of baseline test-code LOC (baseline: 17,164 lines; target: at most 15,447 lines) without raising the test budget ceiling.
- [ ] Repair or remove flaky assertions discovered during the audit, with retained assertions focused on stable externally observable behavior.
- [ ] Reduce measured suite runtime where practical, prioritising repeated subprocess, timer, repository, and server setup.
- [ ] Keep the default core suite, heavy unit and integration suites, and browser suite passing.
- [ ] Record exact before/after LOC and runtime measurements and identify any residual test gaps.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm run test:core:full
npm run test:browser:full
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach
- Establish baseline LOC and per-file timings using the existing budget and parallel runner.
- Map tests to production modules and compare overlapping test names/assertions before deleting coverage.
- Prefer table-driven consolidation and shared fixtures when cases protect distinct inputs but repeat setup.
- Delete whole tests only when behavior is obsolete, duplicated at a more appropriate layer, or asserted through implementation details rather than outcomes.
- Re-run focused tests after each cluster change, then all project test tiers.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- Existing custom test harness in `tests/_helpers.js`, parallel runner, and Playwright configuration.

## Out of Scope
- Product refactors unrelated to test effectiveness or execution performance.
- Live-agent browser tests requiring external provider credentials.

## Open Questions
- None; retain compatibility coverage unless repository policy or another test proves it redundant.

## Related
<!-- Links to research topics, other features, or external docs -->
- Prior work: 2026-05-12 and 2026-07-12 test-budget reductions documented in `scripts/check-test-budget.sh`.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
