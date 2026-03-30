# Feature: Unified Workflow Engine

## Summary

Merge the sync research engine (`research-engine.js`, 195 lines) into the async feature engine (`engine.js`, 810 lines) so both entity types use one API surface, one locking model, and one event pipeline. Today features and research have fundamentally incompatible engines — async vs sync, effects vs direct writes, different locking — which means every new capability must be implemented twice. This unification makes the workflow-core a single system that research and features both consume through the same interface.

This feature also finishes the migration boundary: once it lands, feature and research lifecycle writes should no longer depend on bootstrap-only or entity-specific compatibility branches to do normal work.

## User Stories

- [ ] As a developer, I want research and feature workflows to use the same engine API so I don't have to learn two systems or maintain parallel code paths
- [ ] As a user, I want heartbeat sweep and agent recovery to work for research the same way it works for features
- [ ] As a developer, I want spec-move logic in one place (the effect system) so there's a single path to debug when specs end up in the wrong folder
- [ ] As a maintainer, I want migration tooling that moves old active entities onto the engine so later cleanup work can delete fallback logic instead of preserving it forever

## Acceptance Criteria

- [ ] `research-engine.js` is deleted — all research operations go through `engine.js`
- [ ] New async API functions exist: `startResearch()`, `showResearch()`, `requestResearchEval()`, `closeResearch()` — mirroring the feature API but using the research XState machine
- [ ] Research commands in `lib/commands/research.js` call the new async API (no more `*Sync()` calls)
- [ ] Research spec moves use the effect system (same `move_spec` effect type as features)
- [ ] Research workflows produce event logs and snapshots at `.aigon/workflows/research/{id}/`
- [ ] `sweepExpiredHeartbeats()` works for both entity types (reads research snapshots too)
- [ ] A migration surface exists to initialize or backfill workflow state for active pre-cutover feature and research items
- [ ] Normal feature and research lifecycle commands no longer need command-layer bootstrap logic for new entities
- [ ] All existing research commands work end-to-end: `research-create`, `research-start`, `research-eval`, `research-close`, `research-submit`
- [ ] `node -c aigon-cli.js` passes (syntax check)
- [ ] Feature workflows are unaffected — no regressions in feature lifecycle
- [ ] The end state is structurally simpler than the start state: no second permanent research engine path remains, and superseded compatibility branches are removed or explicitly isolated as temporary migration code

## Validation

```bash
node -c aigon-cli.js
node -c lib/workflow-core/engine.js
node -c lib/workflow-heartbeat.js
# Verify research-engine.js is gone
test ! -f lib/workflow-core/research-engine.js
```

## Technical Approach

### 1. Generalize `engine.js` to be entity-aware

Add an `entityType` parameter ('feature' | 'research') to existing engine functions. Internally, select the correct XState machine (`featureMachine` vs `researchMachine`) based on entity type. The research machine already exists in `machine.js` — it just needs the async wrapper.

### 2. Unified API surface

```
startEntity(repoPath, entityType, entityId, mode, agents)
showEntity(repoPath, entityType, entityId)
requestEntityEval(repoPath, entityType, entityId)
closeEntity(repoPath, entityType, entityId)
closeEntityWithEffects(repoPath, entityType, entityId, executor, opts)
```

Keep the existing feature-specific convenience functions (`startFeature()`, etc.) as thin wrappers that call the generic versions with `entityType: 'feature'`. Add matching research wrappers.

### 3. Research uses the effect system for spec moves

Instead of inline `moveSpecProjectionSync()` in the research engine, emit `move_spec` effects the same way features do. The effect executor in `effects.js` already handles `move_spec` — research just needs to trigger it.

### 4. Wire heartbeat sweep

`sweepExpiredHeartbeats()` in `workflow-heartbeat.js` currently only reads feature snapshots. Extend it to also iterate `.aigon/workflows/research/*/snapshot.json`. Remove the duplicate heartbeat-check code from `supervisor.js`.

### 5. Encapsulate event access

Add `showEntityOrNull()` that returns null if the workflow hasn't been initialized (for the pre-start check in commands). Commands should never call `readEvents()` + `projectContext()` directly.

### 6. Make migration explicit, not ambient

Add a workflow migration path for active pre-cutover entities so commands stop quietly synthesizing engine history as part of unrelated operations like close/eval. Migration should be idempotent, report what it changed, and become the only supported bridge from legacy state to engine state.

### Key files to modify:

- `lib/workflow-core/engine.js` — generalize to accept entityType
- `lib/workflow-core/machine.js` — ensure researchMachine is exported and compatible
- `lib/workflow-core/effects.js` — no change needed (already generic)
- `lib/workflow-core/index.js` — export new research API functions
- `lib/commands/research.js` — switch from sync to async API calls
- `lib/commands/feature.js` — reduce or remove command-layer bootstrap branches once migration exists
- `lib/workflow-heartbeat.js` — iterate both entity type snapshot dirs
- `lib/supervisor.js` — remove duplicate heartbeat check code
- `lib/workflow-snapshot-adapter.js` — verify it handles research snapshots through the new path
- `lib/entity.js` — remove `moveSpecProjectionSync` calls, let effects handle it
- DELETE `lib/workflow-core/research-engine.js`

## Dependencies

- None — this is the foundation for the other two features

## Out of Scope

- Changing the XState machine definitions (feature and research keep their distinct state machines)
- Feedback entity workflow (feedback stays on simple filesystem transitions)
- Agent status file consolidation (that's Feature 2)
- Action derivation consolidation (that's Feature 3)
- Dashboard action ranking or UI rendering changes

## Open Questions

- Should research effects be async-only, or should the CLI simply await the same async engine path for interactive commands?
- Should the entity type be encoded in the event type prefix (`research.started` vs `feature.started`) or normalized to a generic prefix (`entity.started`)?
- Should migration be a dedicated command (`aigon workflow-migrate`) or an internal utility invoked by setup/doctor flows?

## Related

- Feature: Single Source of Truth for Agent Status (depends on this)
- Feature: Backend-Driven Action Derivation (depends on this)
