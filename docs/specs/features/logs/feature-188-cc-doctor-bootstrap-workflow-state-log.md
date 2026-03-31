# Implementation Log: Feature 188 - doctor-bootstrap-workflow-state
Agent: cc

## Plan

Single-file change to `lib/commands/setup.js`:
1. Add `findEntitiesMissingWorkflowState()` — scans feature + research spec folders, checks for missing `.aigon/workflows/{type}/{id}/snapshot.json`
2. Add `bootstrapMissingWorkflowSnapshots()` — writes minimal `events.jsonl` (with `feature.bootstrapped` / `research.bootstrapped` event) and `snapshot.json` for each missing entity
3. Wire into doctor command as a new check section before the summary

## Progress

- Implemented all three functions and the doctor integration in one commit
- Syntax validated with `node -c`

## Decisions

- Used sync `fs` (not async `fs/promises`) since the doctor command is synchronous
- Mapped spec folder stages to workflow lifecycle states (inbox→backlog, in-progress→implementing, etc.)
- Bootstrap snapshot has `mode: null` and empty `agents: {}` since the entity hasn't been started yet — just enough for the dashboard to show action buttons
- Never overwrites existing snapshots or events — append-only safety
- Did NOT refactor `rebuildSeedFeatureManifests()` to call the shared bootstrap — that function creates `.aigon/state/` manifests (different from workflow-core snapshots) and has seed-reset-specific logic (moving specs back to backlog). The two concerns are separate.
