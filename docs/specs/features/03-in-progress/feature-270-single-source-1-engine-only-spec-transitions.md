# Feature: single-source-1-engine-only-spec-transitions

## Summary
Enforce that all feature/research lifecycle spec moves go through the workflow engine's `move_spec` effect. Normal lifecycle commands must never infer or recreate workflow state from folder position. When folder position disagrees with existing engine state during a transition, the engine wins and the file is moved to the engine-expected location. Remove the bootstrap path that creates snapshots from folder position during normal setup/doctor flows.

## User Stories
- [ ] As a user, when I run any aigon command that transitions feature state, the spec file always ends up in the correct folder matching the engine
- [ ] As a user, if a spec file is in the wrong folder (e.g. due to a stale git operation), it gets auto-corrected on the next state transition
- [ ] As a user, if a numeric feature/research spec is missing workflow state, normal lifecycle commands tell me to migrate it instead of silently rebuilding state from the filesystem

## Acceptance Criteria
- [ ] All feature/research lifecycle transition code paths move spec files through the workflow engine's `move_spec` effect; no direct `git mv` / `fs.renameSync` / `utils.moveFile()` remains in normal lifecycle transitions
- [ ] Destructive reset flows (`feature-reset`, `research-reset`) are explicitly out of scope for this feature and are not used as precedent for lifecycle transition behavior
- [ ] `lib/commands/setup.js` init/doctor/bootstrap no longer creates snapshots with lifecycle inferred from folder position
- [ ] If a spec file exists in an unexpected folder for an entity that already has workflow state, a warning is logged and the file is moved to the engine-expected location during the transition
- [ ] Manual `git mv` of a spec file becomes cosmetic drift that gets auto-corrected engine -> folder, not a state mutation
- [ ] If a numeric feature/research spec exists but no workflow snapshot exists, normal state-changing commands do not recreate workflow state from folder position; they fail with explicit migration guidance
- [ ] The only allowed path for creating missing workflow snapshots for legacy numeric entities is an explicit migration/backfill flow, not a normal lifecycle command

## Validation
```bash
node --check aigon-cli.js
npm test
```

Manual scenarios:
- [ ] Existing snapshot + stale folder position -> transition logs warning and restores engine-expected location
- [ ] Numeric spec with no snapshot -> state-changing command refuses and points to migration/backfill flow
- [ ] Re-running the same transition after correction is idempotent

## Technical Approach
- Audit all feature/research lifecycle transition paths and route spec moves through workflow-core effects only
- Remove normal-operation bootstrap that seeds snapshots from visible folder position
- Add transition-time correction: if workflow state exists and the visible file is in the wrong folder, move it to the engine-expected path and log a warning
- Define/retain one explicit migration or backfill path for legacy numeric entities with missing workflow state
- Audit direct movers in lifecycle code, including shared entity helpers and feature/research command handlers
- Key files: `lib/workflow-core/effects.js`, `lib/workflow-core/engine.js`, `lib/commands/setup.js`, `lib/commands/feature.js`, `lib/commands/research.js`, `lib/entity.js`, `lib/feature-spec-resolver.js`

## Migration Scope (measured 2026-04-19)

Counted on the aigon repo before implementation starts, so the migration command has a known-small scope:

**Features (6 missing-snapshot numeric entities):**
- `01` — pre-engine feature (`05-done/feature-01-support-hooks`). True legacy.
- `238, 270, 271, 272, 273` — prioritised backlog items. `feature-prioritise` inconsistently creates snapshots: F246 has one but F238 and F270-273 don't. Root cause is likely a change in the prioritise flow at some point between F246 and F238 being queued. The migration must backfill these, and the bug in `feature-prioritise` (if confirmed) should be fixed as part of this feature or tracked separately.

**Research (0 missing-snapshot numeric entities):**
- All 30 numeric research topics have snapshots. No migration needed.
- Aside: 4 snapshots at IDs `13, 15, 23, 52` have no matching spec (orphaned snapshots from deleted specs). Not in scope for this feature — tracked separately as a research-workflow cleanup concern.

Migration command: a one-shot `aigon repair --backfill-snapshots` (or similar) that creates a minimal snapshot for each of the 6 listed features from the spec's current folder position. This is the ONE allowed exception to "never recreate workflow state from folder position" and must be behind an explicit flag so it never runs as part of a normal command.

## Dependencies
- None

## Out of Scope
- Migrating read paths (board/dashboard) from folder scanning — that's feature single-source-2
- Self-healing reconciliation on read — that's feature single-source-3
- Feedback entity changes — that's feature single-source-4
- Reset/teardown choreography for `feature-reset` / `research-reset`

## Open Questions
- None

## Related
- Research: research-33-single-source-of-truth-for-feature-state
