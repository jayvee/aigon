# Feature: workflow-engine-migrate-feature-start

## Summary

Migrate `feature-start` to use the workflow-core engine instead of the legacy state machine + manifest system. This is the highest-priority migration because `feature-start` creates new engine state from scratch — no bootstrap-from-legacy bridge needed (unlike feature-close). Once features are started through the engine, all downstream transitions (eval, close, pause) have clean event-sourced state to work with. This is the foundation that unlocks everything else.

## User Stories

- [ ] As a user running `feature-start 42 cc gg`, the feature is started through the workflow-core engine with a complete event log from the first moment
- [ ] As a user viewing the dashboard, features started via the engine show accurate state derived from snapshots, not dual-read heuristics
- [ ] As a user resuming after a crash during `feature-start`, the engine detects the incomplete start and resumes where it left off (durable effects)

## Acceptance Criteria

- [ ] `feature-start` calls `engine.startFeature()` instead of `requestTransition('feature-start')`
- [ ] Engine creates `events.jsonl` and `snapshot.json` in `.aigon/workflows/features/{id}/`
- [ ] Start effects (move-spec, create-worktree per agent, init-log per agent) run through the engine's claim/reclaim effect lifecycle
- [ ] If a start is interrupted mid-effect, re-running `feature-start` detects the in-progress workflow and resumes pending effects
- [ ] Feature mode (`solo_branch`, `solo_worktree`, `fleet`) is determined from agent count and config, stored in engine state
- [ ] Legacy `requestTransition` path remains as fallback when `workflow.startEngine` flag is off (same pattern as `workflow.closeEngine`)
- [ ] Dashboard and board continue to work — snapshot adapter already handles engine-started features
- [ ] Manifest is still written for backward compatibility with agent status files (agents write to `.aigon/state/feature-{id}-{agent}.json`)
- [ ] All existing `feature-start` flags work: agent list, `--no-launch`, `--background`

## Validation

```bash
node --check lib/dashboard-server.js
node --check lib/commands/feature.js
npm test
```

## Technical Approach

### Pattern: follow the feature-close bridge

`lib/workflow-close.js` established the bridge pattern: a separate module that wraps engine calls, maps between legacy and engine concepts, and is gated behind a config flag. Create `lib/workflow-start.js` following the same pattern.

### Key mapping

| Legacy concept | Engine concept |
|---|---|
| `requestTransition('feature-start', { agents })` | `engine.startFeature(id, { agents, mode })` |
| Manifest `events.push({ type: 'transition:feature-start' })` | Engine event `feature.started` |
| `completePendingOp('create-worktree-cc')` | Effect `ensure_agent_session` (claimed -> succeeded) |
| Spec file move (inbox -> in-progress) | Effect `move_spec` (or `ensure_feature_layout`) |
| PID-based advisory lock | Exclusive file lock via `lock.js` |

### What NOT to change

- Agent status files (`.aigon/state/feature-{id}-{agent}.json`) — agents write these directly, keep them
- Worktree creation mechanics in `lib/worktree.js` — call the same functions, just wrap them as effects
- Dashboard/board reads — already handled by snapshot adapter

## Dependencies

- None — this is the foundation feature

## Out of Scope

- Migrating feature-eval, pause/resume, or other transitions (separate features)
- Removing the legacy state machine (phase 6)
- Research workflow migration

## Open Questions

- Should we auto-enable the engine for new features once stable, or keep it opt-in per-project?
- Do we need a migration tool for in-flight legacy features, or just let them complete under the old system?

## Related

- `lib/workflow-close.js` — established the bridge pattern to follow
- `lib/workflow-core/engine.js` — `startFeature()` API
- `lib/workflow-core/effects.js` — effect lifecycle
- `~/src/aigon-next/docs/integration-into-aigon.md` — original migration plan
- `docs/architecture.md` § "Workflow-Close Bridge"
