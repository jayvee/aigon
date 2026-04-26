---
complexity: medium
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
set: agent-matrix
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T01:30:52.359Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-matrix-2-brewboard-benchmark

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Phase A2 of the agent-matrix research. Add `docs/benchmarks/{implement,spec-review,code-review,draft}.md` canonical fixtures to the Brewboard seed repo. Add a recurring template `docs/specs/recurring/weekly-agent-matrix-benchmark.md` that, for each (agent × model) cell with stale or missing data, runs the implement fixture against a fresh `seed-reset` of Brewboard. Lean on the existing `lib/recurring.js` machinery — no bespoke benchmark runner. The existing `feature-close` path writes `stats.json`, which `lib/stats-aggregate.js` rolls up into `perTriplet`, and the `lib/agent-matrix.js` collector picks it up automatically.

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
- depends_on: agent-matrix-1-data-and-view

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
-

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
- Research: #41 agent-model-capability-matrix
- Set: agent-matrix
- Prior features in set: agent-matrix-1-data-and-view
