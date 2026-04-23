---
complexity: medium
set: publish-npm-package
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T13:58:56.928Z", actor: "cli/feature-prioritise" }
---

# Feature: publish-npm-package-6-packaged-server-lifecycle-management

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Make `aigon server` work cleanly from a globally installed package, including persistent mode, startup discovery, and shutdown behavior. This feature closes the gap between a repo-cloned Aigon and a package-installed Aigon so the server lifecycle still behaves predictably.

## User Stories
- As a globally installed user, I want `aigon server` to find the active repo and start without manual path wiring.
- As a maintainer, I want persistent server mode to keep working in the packaged install path.

## Acceptance Criteria
- The server command works when Aigon is installed globally, not only from a cloned repo checkout.
- Persistent mode continues to start, restart, and health-check correctly in the packaged install path.
- Server lifecycle commands resolve the repo context before mutating runtime state.
- The behavior matches the existing local install experience except for the global-distribution wiring.

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
Keep server lifecycle orchestration in the same command surface, but make repo resolution and persistent-mode wiring robust to the package-install execution path. The implementation should reuse the existing server management machinery rather than introducing a second lifecycle model.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- depends_on: publish-npm-package-1-package-structure-and-publishing

## Out of Scope
- release tagging, onboarding, and prerequisite detection

## Open Questions
- Should persistent mode keep using the current supervisor path, or require a package-specific launcher?

## Related
- Research: #38 publish-npm-package
