---
complexity: medium
set: publish-npm-package
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T13:58:55.689Z", actor: "cli/feature-prioritise" }
---

# Feature: publish-npm-package-3-update-notifications-and-dashboard-status

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Create one shared npm version check that powers CLI update notices, slash-command output, and dashboard status for installed Aigon instances. The goal is to stop each surface from inventing its own version logic and to show the same upgrade signal everywhere.

## User Stories
- As a user, I want the CLI to tell me when a newer Aigon version is available.
- As a user in a dashboard or agent session, I want the same update state shown consistently instead of different components disagreeing.

## Acceptance Criteria
- CLI, slash-command, and dashboard update states come from the same shared version-check helper.
- The check can distinguish installed, latest available, prerelease, and unavailable states.
- Offline or registry-failure cases degrade cleanly without crashing the caller.
- The payload includes enough metadata for the UI to present a useful upgrade prompt.

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
Centralize npm registry lookup and semver comparison in one helper, then have each surface render from the same normalized result. This keeps the UI thin and avoids drift between CLI output and dashboard state.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- depends_on: publish-npm-package-1-package-structure-and-publishing

## Out of Scope
- release automation and install-time onboarding

## Open Questions
- Should update checks run on a timer, on startup, or both?

## Related
- Research: #38 publish-npm-package
