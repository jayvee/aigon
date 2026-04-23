---
complexity: medium
---

# Feature: NPM Package Structure and Publishing

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Lay the groundwork for shipping Aigon as a global npm package and split the work into the six ordered `publish-npm-package` feature slices. This umbrella spec exists to capture the overall goal and scope; the concrete implementation lives in the set members.

## User Stories
- As a maintainer, I want a single umbrella for the package-publishing effort so I can see the full rollout shape.
- As a maintainer, I want the actual implementation to be split into smaller ordered features so release risk stays low.

## Acceptance Criteria
- The umbrella spec describes the package publishing initiative at a high level.
- The detailed implementation is decomposed into the six backlog features in the `publish-npm-package` set.
- The research link points back to the canonical findings document.

## Validation
```bash
node -c aigon-cli.js
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
Treat this as the parent coordination spec rather than the implementation spec. The publish work is intentionally split into package boundary, release channels, update checks, onboarding, prerequisites, and server lifecycle slices.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
-

## Out of Scope
- the detailed implementation tasks covered by the `publish-npm-package` set

## Open Questions
- Should this umbrella remain in inbox, or be retired once the set features are approved?

## Related
- Research: #38 publish-npm-package
