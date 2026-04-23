---
complexity: medium
set: publish-npm-package
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T13:58:56.524Z", actor: "cli/feature-prioritise" }
---

# Feature: publish-npm-package-5-prerequisite-checks-and-remediation

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Add install-time prerequisite checks for global Aigon so obvious blockers are caught before a user assumes the package is working. The feature also provides remediation guidance for soft failures so the user can fix their environment without guessing.

## User Stories
- As a user, I want Aigon to tell me immediately if my Node, npm, or git setup cannot support the package.
- As a user, I want actionable remediation instructions when a prerequisite is missing or below the supported version.

## Acceptance Criteria
- Hard blockers fail fast with a clear explanation.
- Soft issues are reported with remediation steps rather than silently ignored.
- The prerequisite check covers the runtime dependencies needed for global install and setup.
- The output is understandable in both interactive and scripted contexts.

## Validation
```bash
npm test
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
Implement a small checker that splits prerequisites into hard failures and soft warnings, then emits concrete remediation steps for each class. The logic should be reusable by setup and by later repair/doctor flows.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- depends_on: publish-npm-package-4-interactive-global-setup

## Out of Scope
- release channels and npm publication mechanics

## Open Questions
- Which prerequisites should be treated as warnings versus hard stops for the first release?

## Related
- Research: #38 publish-npm-package
