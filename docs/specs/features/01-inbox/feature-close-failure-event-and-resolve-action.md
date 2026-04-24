---
complexity: medium
---

# Feature: close-failure-event-and-resolve-action

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
<!-- One paragraph describing what this feature does and why -->

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
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
-

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
-

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: <!-- ID and title of the research topic that spawned this feature, if any -->
- Set: <!-- set slug if this feature is part of a set; omit line if standalone -->
- Prior features in set: <!-- feature IDs that precede this one, e.g. F314, F315; omit if standalone -->
