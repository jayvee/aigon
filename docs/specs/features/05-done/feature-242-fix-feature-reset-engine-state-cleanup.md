# Feature: fix-feature-reset-engine-state-cleanup

## Summary

`aigon feature-reset <id>` does not clean up `.aigon/workflows/features/<id>/` workflow engine state files — it only touches the legacy `.aigon/state/` manifest files. This leaves features in a **half-reset state**: the spec is correctly moved back to `02-backlog/`, worktrees and branches are removed, but the engine snapshot still says `"lifecycle": "implementing"` with agents marked `ready`. The next `feature-start <id> <agent>` will either refuse (engine state machine rejects the transition) or silently end up in the same stuck state.

Fix `feature-reset` to also remove the workflow engine state directory for the feature, so reset actually means reset.

## Context — how this bug surfaced

Discovered 2026-04-08 during the feature-241 restart flow (see the `create-with-agent` feature for context). User had to manually `rm -rf .aigon/workflows/features/241/` before `feature-reset 241` worked correctly. A normal user would run `feature-reset`, see "Reset complete", then get confusing errors on the next `feature-start`. This is the kind of silent breakage that makes users distrust the tooling.

The bug is in `lib/commands/feature.js:feature-reset` around line 2168–2182: it only walks the `getStateDir()` path (which points at `.aigon/state/`, the legacy manifest location) and removes files matching `feature-NNN-*`. The new workflow engine stores its state at `.aigon/workflows/features/<id>/` and that directory is completely untouched by the reset.

## User Stories

- [ ] As a user who accidentally started a feature with the wrong spec / wrong agent / during config bleed, I can run `aigon feature-reset <id>` once and have the feature fully back in the "never started" state — no manual `rm -rf` required.
- [ ] As a user running `feature-reset` followed immediately by `feature-start`, I expect the second command to succeed as if the feature were fresh. No "feature is already in state X" errors. No lingering agent `ready` flags in the engine.
- [ ] As a user reading the reset output, I can see in the console message that workflow engine state was cleaned (not just legacy state), so I know the reset was complete.

## Acceptance Criteria

- [ ] **AC1** — After `aigon feature-reset <id>`, the directory `.aigon/workflows/features/<id>/` does not exist.
- [ ] **AC2** — After `aigon feature-reset <id>`, running `aigon feature-start <id> <agent>` starts the feature cleanly as if it were a fresh prioritised feature from backlog. No migration fallbacks, no state-machine errors, no lingering engine state.
- [ ] **AC3** — The reset console output reports the workflow engine state cleanup explicitly, e.g. `🗑️  Removed workflow state: .aigon/workflows/features/241/` alongside the existing worktree/branch/state/spec output.
- [ ] **AC4** — If the engine state directory doesn't exist (e.g. the feature never used workflow-core, or was already partially reset), the cleanup is a no-op — no warnings, no errors, silent skip.
- [ ] **AC5** — Reset is idempotent: running `feature-reset <id>` twice in a row doesn't fail. Second run is a no-op for each step.
- [ ] **AC6** — `aigon feature-close <id>` is not affected by this change — it has its own engine-state transition path and should keep working as-is.
- [ ] **AC7** — Regression test: a source-level assertion that `lib/commands/feature.js:feature-reset` explicitly removes `.aigon/workflows/features/<id>/` (matches the existing source-regression-guard test pattern).

## Validation

```bash
node --check lib/commands/feature.js

# Manual end-to-end:
cd ~/src/aigon
# 1. Start a throwaway feature
aigon feature-create reset-test "a throwaway feature for testing reset"
aigon feature-prioritise reset-test
aigon feature-start <id> cc       # note the ID
ls .aigon/workflows/features/<id>/  # should exist
# 2. Reset
aigon feature-reset <id>
ls .aigon/workflows/features/<id>/ 2>&1  # should NOT exist
# 3. Start again — should work cleanly
aigon feature-start <id> cc
# 4. Clean up the throwaway
aigon sessions-close <id>
aigon feature-reset <id>
rm docs/specs/features/02-backlog/feature-reset-test.md
```

## Technical Approach

### Option A (minimal): remove the directory directly in feature-reset

In `lib/commands/feature.js:feature-reset`, after the existing cleanup block (worktrees, branches, state files, spec move), add:

```js
// Remove workflow-core engine state (new system — separate from legacy .aigon/state/)
const engineStateDir = path.join(process.cwd(), '.aigon', 'workflows', 'features', paddedId);
if (fs.existsSync(engineStateDir)) {
    try {
        fs.rmSync(engineStateDir, { recursive: true, force: true });
        console.log(`   🗑️  Removed workflow engine state: .aigon/workflows/features/${paddedId}/`);
    } catch (e) {
        console.warn(`   ⚠️  Could not remove workflow engine state at ${engineStateDir}: ${e.message}`);
    }
}
```

Also handle the unpadded ID variant if aigon's ID handling is inconsistent (shouldn't be, but defensive).

### Option B (cleaner): add a `resetFeature` API to the workflow engine

Add a new function in `lib/workflow-core/engine.js`:

```js
async function resetFeature(repoPath, featureId) {
    const { featureDir } = getFeatureWorkflowPaths(repoPath, featureId);
    if (fs.existsSync(featureDir)) {
        fs.rmSync(featureDir, { recursive: true, force: true });
    }
}
module.exports = { ...existing, resetFeature };
```

Then `feature-reset` calls `wf.resetFeature(repoPath, paddedId)` alongside the legacy cleanup. Encapsulates the engine implementation detail, easier to test in isolation, follows the existing pattern of other engine functions.

**Recommendation: Option B.** It keeps engine internals behind the engine API and sets the pattern for future cleanup operations. The CLI command shouldn't know where engine state is stored.

### Edge cases

- **Locked state files**: if another process is holding the feature's workflow lock (e.g. a concurrent `aigon feature-close` attempt), the `rmSync` will fail. Catch the error, warn, and continue — the user can re-run after the other process finishes.
- **Worktrees that still reference the engine state**: the existing reset already removes worktrees first, so by the time the engine cleanup runs, nothing should be reading the engine state. Order of operations matters; document it.
- **Feature was never in workflow-core** (old features from before the engine migration): the directory simply won't exist. `fs.existsSync()` check handles this cleanly.
- **Partial reset**: if the engine cleanup fails but the legacy cleanup already succeeded, the next `feature-start` hits the same bug. Make the engine cleanup run LAST in the reset sequence so a failure there doesn't leave the feature in an even worse state.

### Testing

- Source-level assertion that `.aigon/workflows/features` is referenced in the reset handler
- Add to the existing `tests/integration/worktree-config-isolation.test.js` file (which has become the source-regression-guard home). ~3 LOC of new assertions.

## Dependencies

- None — pure bug fix in existing `feature-reset` command
- Blocks: `feature-dashboard-reset-action` (that feature depends on a correctly-working CLI reset before wrapping it in a dashboard button)

## Out of Scope

- **Dashboard UI for reset** — that's a separate feature (`feature-dashboard-reset-action`), which depends on this fix landing first.
- **Refactoring `feature-reset` end-to-end** — this is a surgical fix for the engine-state gap, not a rewrite. The existing structure is kept.
- **Adding a `--confirm` or dry-run flag to the CLI** — useful but out of scope for the bug fix.
- **Cleaning up other stale engine state** (e.g. research, feedback) — feature-reset is feature-only. Research has its own reset path.

## Open Questions

- Option A vs Option B — should the fix put the `rmSync` directly in the CLI handler or behind an engine API? Recommend **Option B** (engine API), but Option A is acceptable as a v1 if the engine API work is deemed out of scope.
- Should `feature-reset` also emit a `feature.reset` event to the engine's event log for audit purposes? Probably no — reset is a destructive, out-of-band operation. Events are for state-machine transitions, not recovery.
- Does this bug affect `research-reset`? Worth a quick check — the research reset code path may have the same shape. If yes, file a sibling fix under research.

## Related

- `lib/commands/feature.js:feature-reset` — where the bug lives (around line 2127)
- `lib/workflow-core/engine.js` — where `resetFeature()` would be added under Option B
- `lib/workflow-core/paths.js` — defines `.aigon/workflows/features/<id>/` path shape
- 2026-04-08 feature 241 restart incident — the bug that prompted this spec
- Follow-up feature: `feature-dashboard-reset-action` — depends on this fix
