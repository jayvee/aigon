---
complexity: medium
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
set: agent-matrix
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T01:31:03.418Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-matrix-6-qualitative-refresh

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Phase C (quarterly) of the agent-matrix research. Add a separate recurring template `docs/specs/recurring/quarterly-agent-matrix-qualitative-refresh.md` that scans SWE-bench Verified, Aider polyglot leaderboard, LMArena, and signal community sources to propose updates to `cli.modelOptions[].notes.<op>` and `cli.modelOptions[].score.<op>`. Reuses the feedback-item + `aigon matrix-apply` flow from feature 5 — only the cadence and source list differ. Quarterly because qualitative scores shouldn't churn weekly; constant "vibes" updates erode trust.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ]
- [ ]

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ]
- [ ]

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the general test suite.
     All commands must exit 0 for the iteration to be considered successful.
-->
```bash
# Example: node --check aigon-cli.js
```

## Pre-authorised
<!-- Optional: standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     Absent or blank = no pre-auths; agent stops on every policy gate as normal.
     Example lines:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
       - May skip `npm run test:ui` when this feature touches only `lib/` and no dashboard assets.
-->

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

## Dependencies
- depends_on: agent-matrix-5-pricing-refresh

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
-

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
- Research: #41 agent-model-capability-matrix
- Set: agent-matrix
- Prior features in set: agent-matrix-1-data-and-view, agent-matrix-5-pricing-refresh
