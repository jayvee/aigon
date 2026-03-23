# Feature: flagged-feature-close-on-new-workflow-engine

## Summary

Replace Aigon’s existing `feature-close` implementation with the new workflow-engine-driven close path behind an explicit feature flag. This is the first write-side migration and should focus on resumable effect execution, explicit claim/reclaim semantics, and safer operator behavior for close and merge workflows.

## User Stories

- As a maintainer, I want to migrate the hairiest feature command first so we reduce risk in the area that currently causes the most complexity.
- As a user closing a feature, I want close behavior to be resumable and operationally clear when interrupted.
- As an AI agent working on workflow code, I want close semantics to be modeled through the new engine instead of a large monolithic command path.

## Acceptance Criteria

- A feature flag enables using the new workflow-engine-driven `feature-close` path.
- The flagged path supports:
  - explicit close request
  - claimed/resumable close effects
  - clear operator feedback when a healthy claim blocks immediate retry
  - explicit reclaim/override behavior where appropriate
- Existing `feature-close` behavior remains available when the flag is off.
- Tests cover successful close, interrupted close, blocked retry, reclaim/resume, and fallback behavior when the flag is disabled.
- Documentation explains how to enable and validate the flagged path.

## Validation

```bash
npm test
node -c aigon-cli.js
node -c lib/commands/feature.js
```

Manual validation:

- Run the flagged close path in a seeded repo.
- Inject or simulate interrupted close behavior.
- Verify operator output is clear and resume/reclaim works as intended.

## Technical Approach

- Introduce a feature flag or config gate for the new `feature-close` path.
- Route close behavior through the imported workflow core and its effect lifecycle.
- Keep legacy close path intact while the new path is proven.
- Reuse the dashboard/read-side integration where possible so state and actions remain coherent.

## Dependencies

- Depends on importing the workflow core into Aigon.
- Strongly benefits from the dashboard/board reading from the new snapshot model first.

## Out of Scope

- Replacing `feature-start`
- Full workflow migration of every feature command
- Replacing research flows

## Open Questions

- What is the best flag surface: env var, config option, or hidden development toggle?
- Which parts of Aigon’s current git/security/telemetry close flow should remain in the first flagged cut, and which should be deferred?

## Related

- `lib/commands/feature.js`
- `docs/architecture.md`
- `docs/specs/features/01-inbox/feature-import-aigon-next-workflow-core.md`
- `docs/specs/features/01-inbox/feature-dashboard-read-from-workflow-snapshots.md`

