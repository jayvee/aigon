# Feature: Doctor — bootstrap missing workflow state

## Summary

Extend `aigon doctor` to detect features and research topics that have spec files but no workflow-core snapshots, and bootstrap minimal workflow state for them. This handles the common case of repos that were created before the workflow engine existed, or where specs were written manually (not through `aigon feature-create` / `aigon feature-prioritise`). Without workflow state, the dashboard can't show action buttons and `feature-start` may behave unexpectedly.

The bootstrap logic already exists in `rebuildSeedFeatureManifests()` (added for seed repos). This feature extracts it into a reusable function and wires it into `aigon doctor --fix`.

## User Stories

- [ ] As a developer adding Aigon to an existing repo with manually-created feature specs, I want `aigon doctor --fix` to create workflow state so the dashboard works immediately
- [ ] As a developer upgrading from an older Aigon version (pre-workflow-engine), I want doctor to detect and fix missing workflow state without losing any existing state
- [ ] As a developer, I want `aigon doctor` (without --fix) to report which features are missing workflow state so I can decide whether to fix them

## Acceptance Criteria

### Detection (always, even without --fix)
- [ ] `aigon doctor` scans all spec folders (inbox, backlog, in-progress, done) for features and research with spec files but no corresponding `.aigon/workflows/{type}/{id}/snapshot.json`
- [ ] Reports count of missing workflow snapshots: "⚠️ 4 features missing workflow state (run `aigon doctor --fix` to bootstrap)"
- [ ] If all features have snapshots: "✅ All features have workflow state"

### Fix (with --fix flag)
- [ ] `aigon doctor --fix` creates minimal workflow snapshots for features/research missing them
- [ ] Snapshot lifecycle matches the spec's current folder (inbox → inbox, backlog → backlog, in-progress → in_progress, done → done)
- [ ] Creates a minimal event log entry (`feature.bootstrapped` / `research.bootstrapped`) so event-store reads don't fail
- [ ] Never overwrites existing snapshots — only bootstraps when no snapshot exists
- [ ] Reports what was fixed: "🔧 Bootstrapped workflow state for 4 features"

### Research support
- [ ] Same logic applies to research topics (not just features)
- [ ] Research snapshots use the research entity type and paths

## Validation

```bash
node -c lib/commands/setup.js
```

## Technical Approach

### Extract shared bootstrap function

The bootstrap logic already exists inline in `rebuildSeedFeatureManifests()`. Extract it into a shared function:

```js
// lib/workflow-core/bootstrap.js (or inline in setup.js)
function bootstrapMissingWorkflowSnapshots(repoPath, entities) {
    // entities: [{ id, type, stage, specPath }]
    // Creates snapshot.json + events.jsonl for each entity missing workflow state
}
```

Both `rebuildSeedFeatureManifests()` and `doctor --fix` call this function.

### Doctor integration

Add a new check section in the doctor command (after the existing manifest/stage reconciliation):

1. Scan all spec folders for features with IDs
2. For each, check if `.aigon/workflows/features/{id}/snapshot.json` exists
3. Report missing count
4. If `--fix`, call the bootstrap function

### Files changed

1. **`lib/commands/setup.js`** — add workflow state check to doctor; extract bootstrap logic from `rebuildSeedFeatureManifests()` into a shared helper; call from both places
2. No template changes, no config changes

## Dependencies

- None — builds on the bootstrap logic already added to `rebuildSeedFeatureManifests()`

## Out of Scope

- Migrating existing workflow state between schema versions (that's a separate migration concern)
- Bootstrapping agent status or effects — only lifecycle and spec state
- Automatic detection on `aigon init` or `aigon update` (could be added later, but doctor is the right manual entry point first)

## Open Questions

- Should `aigon init` also run the bootstrap automatically? (Probably yes, as a follow-up)
- Should `check-version` / auto-update trigger bootstrap for upgrades? (Defer — doctor --fix is the manual path first)

## Related

- `rebuildSeedFeatureManifests()` in `lib/commands/setup.js` — already has the inline bootstrap logic
- Workflow-core engine (`lib/workflow-core/`) — snapshot format and event-store
- Dashboard action derivation (`lib/workflow-snapshot-adapter.js`) — consumer of these snapshots
