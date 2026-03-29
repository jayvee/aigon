# Feature: workflow-engine-migrate-pause-resume

## Summary

Migrate `feature-pause` and `feature-resume` to use the workflow-core engine for engine-started features. The XState machine already models a `paused` state with transitions from `implementing` and back to `implementing` on resume. This is a straightforward migration that adds durability to pause/resume — if a pause is interrupted mid-effect, the engine can resume it.

## User Stories

- [ ] As a user pausing a feature, the pause is recorded in the event log and the spec is moved atomically
- [ ] As a user resuming a paused feature, agent sessions can be restarted through the engine's effect system
- [ ] As a user, I can pause a feature even if an agent session has crashed — the engine handles the state correctly

## Acceptance Criteria

- [ ] `feature-pause` checks for engine state; if present, calls `engine.pauseFeature()`
- [ ] `feature-resume` checks for engine state; if present, emits resume event and transitions back to `implementing`
- [ ] Engine emits `feature.paused` / `feature.resumed` events
- [ ] Pause effects (move-spec to paused, optionally kill tmux sessions) run through effect lifecycle
- [ ] Resume effects (move-spec back to in-progress, optionally restart agent sessions) run through effect lifecycle
- [ ] Legacy fallback via `requestTransition` when no engine state exists
- [ ] Dashboard shows paused features correctly via snapshot adapter

## Validation

```bash
node --check lib/commands/feature.js
npm test
```

## Technical Approach

Create `lib/workflow-pause.js` bridge module. Pause and resume are simpler transitions with minimal effects (primarily spec file moves). The main value is event recording and the foundation for phase 4 (agent signals) — when agents detect a paused feature, they can respond appropriately.

### XState mapping

| Action | XState transition | Guard |
|---|---|---|
| `feature-pause` | `implementing` -> `paused` | (none — always allowed from implementing) |
| `feature-resume` | `paused` -> `implementing` | (none) |

## Dependencies

- depends_on: workflow-engine-migrate-feature-start

## Out of Scope

- Research pause/resume (separate migration)
- Auto-pause on agent failure (that's phase 4 — agent signals)

## Open Questions

- Should resume re-launch agent sessions automatically, or just move the spec and let the user re-launch?

## Related

- `lib/workflow-core/machine.js` — `paused` state
- `lib/workflow-core/engine.js` — `pauseFeature()`
