# Feature: single-source-1-engine-only-spec-transitions

## Summary
Enforce that all spec file moves go through the workflow engine's `move_spec` effect. No CLI command, agent, hook, or manual operation should move spec files directly. When folder position disagrees with engine state, auto-correct by moving the file to the engine-expected location. Remove the bootstrap path that creates snapshots from folder position (which is how stale folder state gets reintroduced as bad engine state).

## User Stories
- [ ] As a user, when I run any aigon command that transitions feature state, the spec file always ends up in the correct folder matching the engine
- [ ] As a user, if a spec file is in the wrong folder (e.g. due to a stale git operation), it gets auto-corrected on the next state transition

## Acceptance Criteria
- [ ] All code paths that move spec files go through the workflow engine's `move_spec` effect — no direct `git mv` or `fs.renameSync` on spec files outside the engine
- [ ] `lib/commands/setup.js` bootstrap no longer creates snapshots with lifecycle inferred from folder position
- [ ] If a spec file exists in an unexpected folder (disagrees with engine snapshot), a warning is logged and the file is moved to the engine-expected location
- [ ] Manual `git mv` of a spec file becomes cosmetic drift that gets auto-corrected, not a state mutation

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach
- Audit all code paths that move spec files; ensure every move goes through the engine's `move_spec` effect
- Remove the setup.js bootstrap path that creates snapshots from folder position
- Add auto-correction: on state transitions, if the spec file is in the wrong folder, move it to the engine-expected location and log a warning
- Key files: `lib/workflow-core/effects.js`, `lib/commands/setup.js`, `lib/feature-spec-resolver.js`, `lib/commands/feature.js`

## Dependencies
- None

## Out of Scope
- Migrating read paths (board/dashboard) from folder scanning — that's feature single-source-2
- Self-healing reconciliation on read — that's feature single-source-3
- Feedback entity changes — that's feature single-source-4

## Open Questions
- What should happen when a spec file exists but has no engine state at all? Error, or create engine state from the file?

## Related
- Research: research-33-single-source-of-truth-for-feature-state
