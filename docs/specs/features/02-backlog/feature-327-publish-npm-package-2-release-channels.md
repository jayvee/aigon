---
complexity: medium
set: publish-npm-package
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T13:58:55.293Z", actor: "cli/feature-prioritise" }
---

# Feature: publish-npm-package-2-release-channels

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Add a release lane model for Aigon so stable and prerelease npm publishing are explicit. The feature defines how `latest` and `next` dist-tags are selected, how release metadata is validated, and how the publish flow avoids promoting prerelease builds into the stable channel.

## User Stories
- As a maintainer, I want to publish prerelease builds to `next` without risking the `latest` tag.
- As a maintainer, I want a stable release path that is separate from prerelease automation so users get predictable upgrades.

## Acceptance Criteria
- Stable releases publish to `latest` only when the release criteria are met.
- Prerelease builds publish to `next` and never overwrite `latest`.
- The release process records which dist-tag was used so update checks can interpret the installed version correctly.
- The release flow has enough validation to prevent a release from being tagged with the wrong channel.

## Validation
```bash
npm pack --dry-run
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
Model release intent as an explicit channel decision and keep the publish command responsible for tagging, not guessing. The stable lane should remain conservative, while the prerelease lane can move faster without contaminating stable installs.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- depends_on: publish-npm-package-1-package-structure-and-publishing

## Out of Scope
- update notifications and onboarding

## Open Questions
- Should `next` be the only prerelease channel, or do we also need ad hoc dist-tags for canaries?

## Related
- Research: #38 publish-npm-package
