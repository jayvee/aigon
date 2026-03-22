# Feature: manifest-rebuild

## Summary

The manifest system is fundamentally broken. Every new feature hits `Invalid transition: 'feature-start' from stage 'done'. Expected: backlog` because stale manifests are created before the feature even exists. This has been attempted to be fixed five times in the 2026-03-20/22 session and keeps recurring. The system needs to be rebuilt from the ground up with a clear ownership model.

This feature now intentionally removes folder-derived backward-compat behavior from runtime manifest reads: if a manifest file does not exist, `readManifest()` returns `null`.

## Incident History

### How it started (2026-03-20)

Features 114 and 118 were started from the dashboard. The dashboard's polling cycle called `readManifest(114)` which lazily bootstrapped a manifest by scanning folders. The scan found the spec in `02-backlog` and created a manifest with `stage: backlog`. Then auto-reconcile detected the folder had changed and silently overwrote it to `in-progress`. By the time `feature-start` ran, it saw "already in-progress" and returned early without writing agents. Result: features showed as "Drive" instead of Fleet.

### Fix attempt 1: Remove auto-reconcile

Removed the auto-reconcile from `readManifest()` — no more silent stage rewrites. But this exposed a worse problem: bootstrap was still persisting on read.

### Fix attempt 2: readManifest stops persisting

Changed `readManifest()` to return a transient object without writing to disk. Created `ensureManifest()` for explicit creation. But manifests created by the OLD code were already on disk and couldn't self-correct (since auto-reconcile was removed).

### Fix attempt 3: feature-prioritise calls ensureManifest

Added `manifest.ensureManifest(paddedId)` to `feature-prioritise` so manifests are created at prioritisation time. Should have fixed new features. But it didn't.

### Fix attempt 4: Branch guard

Added `assertOnDefaultBranch()` to prevent commands running on wrong branches. This fixed a different bug (8 commits on wrong branch) but not the manifest issue.

### Fix attempt 5: Manual deletion

Every `feature-start` that fails requires `rm .aigon/state/feature-{id}.json` before retrying. This has been done for features 119, 120, 121, 122, 123, 126, 127, 128, 129, and 130 — ten features in a row.

### Why the fixes didn't work

The root cause was never fully eliminated. The dashboard runs continuously and polls `readManifest()` for every feature ID it discovers from folder scanning. Even though `readManifest()` no longer persists, something else is creating manifests with wrong state. Possible causes:

1. **`ensureManifest()` in `requestTransition()`** — the state machine calls `ensureManifest()` which DOES persist. If the dashboard triggers `requestTransition` indirectly (e.g., via an action dispatch), it could create a manifest before the CLI does.

2. **`deriveFromFolder()` returns wrong stage** — `bootstrapManifest()` calls `deriveFromFolder()` which scans spec folders. If the spec hasn't been moved yet when the dashboard polls, it derives the wrong stage. Or if no spec is found, it may default to `done` or `unknown`.

3. **ID collision** — new feature IDs are assigned sequentially. If a previous feature with the same ID existed (e.g., in a pre-filter-repo history), its manifest might persist in `.aigon/state/`.

4. **Race condition** — the dashboard polling cycle and the CLI command run in separate processes. There's no locking between them for reads.

## How it manifests

Every time:
1. `aigon feature-prioritise <name>` succeeds — spec moved, ID assigned
2. `aigon feature-start <ID> cc cx` fails with `Invalid transition: 'feature-start' from stage 'done'. Expected: backlog`
3. Manual fix: `rm .aigon/state/feature-{id}.json` then retry — works

This happens on 100% of new features. It is the most disruptive bug in the workflow.

## Acceptance Criteria

- [ ] `feature-prioritise` → `feature-start` works on the first try, every time, without manual intervention
- [ ] Dashboard polling never creates or modifies manifest files
- [ ] Manifests are only created by explicit CLI commands: `feature-prioritise`, `feature-start`, `feature-close`
- [ ] No stale manifests exist after a clean `feature-prioritise`
- [ ] `feature-start` on a just-prioritised feature never hits "stage done"
- [ ] Runtime manifest reads never derive state from spec folders; missing manifest reads return `null`
- [ ] Test: automated test that runs prioritise → start → close cycle 5 times without failure
- [ ] The fix survives dashboard being open and polling during the entire cycle
- [ ] No `rm .aigon/state/` workaround needed, ever

## Validation

```bash
# This must pass without manual intervention:
node -e "
const { execSync } = require('child_process');
for (let i = 0; i < 3; i++) {
  execSync('aigon feature-create test-manifest-' + i, { stdio: 'inherit' });
  execSync('aigon feature-prioritise test-manifest-' + i, { stdio: 'inherit' });
  // Simulate dashboard polling
  require('./lib/manifest').readManifest(String(200 + i));
  // This must not fail:
  execSync('aigon feature-start ' + (200 + i), { stdio: 'inherit' });
  execSync('aigon feature-close ' + (200 + i), { stdio: 'inherit' });
  console.log('Cycle ' + i + ' passed');
}
"
```

## Technical Approach

### Option A: Manifests only from explicit command transitions

Remove ALL implicit creation/derivation paths (`ensureManifest()`, `bootstrapManifest()`, lazy folder bootstrap on read). Manifest files are created and rewritten only by explicit feature workflow commands (starting with `feature-prioritise`).

- `readManifest()` returns `null` if no file exists — callers must handle null explicitly
- No runtime folder-derivation fallback for manifests
- Dashboard renders from spec folders + state files directly, without calling manifest bootstrap logic
- Transition validation rejects missing manifests instead of creating them implicitly

### Option B: Manifest creation at feature-create time

Create the manifest when the feature spec is first created (`feature-create`), not at prioritise time. Stage starts as `inbox`. Every subsequent command transitions it. No lazy bootstrap ever.

- Simpler mental model: manifest exists from birth
- `readManifest()` returns null for pre-manifest features (old done features)
- Dashboard shows pre-manifest features from folder scan without creating manifests

### Option C: Drop file-based manifests entirely

Use the folder position as the single source of truth. Agent status files remain. No manifest JSON files at all. The state machine operates on folder position + agent status files.

- Simplest possible system
- No stale state, no race conditions
- But: loses pending ops (outbox pattern), agents list, winner tracking, events log
- Would need alternative storage for those fields

### Recommendation

**Option A** — it's the smallest change that fixes the problem permanently. The key insight: if only `requestTransition()` can create manifests, and `requestTransition()` validates the transition, then no invalid state can ever be written.

## Dependencies

- None — this is foundational

## Out of Scope

- Research manifests (research doesn't use the manifest system)
- Feedback manifests (feedback doesn't use the manifest system)
- Dashboard UI changes
- New features or capabilities

## Related

- Feature #127 manifest-and-branch-safety (attempted fix, insufficient)
- 10 manual manifest deletions across features 119-130
- The stale manifest issue is the #1 workflow reliability problem in aigon
