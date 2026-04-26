---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T00:00:00.000Z", actor: "cli/feature-prioritise" }
---

# Feature: engine-first, folder-fallback correctness (F397)

## Summary

The workflow-core engine (`.aigon/workflows/features/{id}/events.jsonl` + `snapshot.json`) is the declared source of truth for all feature and research lifecycle state. Spec folder position (`01-inbox/`, `05-done/`, etc.) is a user-visible projection — a side effect of engine transitions, not truth itself.

An audit (2026-04-27) found multiple places where code checks folder position **before or instead of** the engine snapshot, producing wrong answers: features blocked by dependencies that are actually done, set conductors stalling on features that completed, and analytics undercounting completions.

The correct invariant — **engine first, folder as explicit fallback for pre-start and legacy pre-engine entities** — is not uniformly applied. This feature enforces it everywhere.

## The correct precedence rule

```
1. Engine snapshot exists → use snapshot.lifecycle as truth
2. No snapshot, spec in folder → entity is pre-start or pre-engine legacy;
   folder position is the best available signal; use it explicitly
3. No snapshot, no spec → entity is unknown; treat as missing, not as done
```

Folder position MUST NOT override engine state when engine state exists. The fallback is legitimate — inbox/backlog entities and legacy pre-engine done features may have no snapshot — but it must be explicit and ordered correctly.

## What must NOT be changed

- **Inbox/backlog folder fallback**: entities that have never been started have no engine snapshot. `buildMissingSnapshotState` already handles this correctly — these entities must continue to receive synthetic pre-engine actions (Prioritise, Start) derived from their folder position. Do not break this.
- **Pre-engine legacy done features**: features completed before workflow-core was introduced have no engine directory. Folder scan of `05-done/` remains the only signal for these. They must be included in analytics and dependency checks via the explicit folder fallback path.
- **`getNextId` three-layer scan**: already fixed in commit d1dc2f81. Do not regress.
- **Feedback entities**: `spec-reconciliation.js` feedback handling uses folder-as-state by design — feedback does not use the workflow-core engine. Out of scope for this feature.

## Violations found

### CRITICAL — produces wrong lifecycle decisions

**1. `lib/set-conductor.js` lines 104-128 — `isFeatureSpecInDoneFolder()`**

Checks `05-done/` folder FIRST to determine if a set member is complete. Engine snapshot consulted only as fallback. A feature whose spec drifted from `05-done/` is treated as not done, stalling the entire set.

Fix: check engine snapshot first (`snapshot.lifecycle === 'done'`). Fall back to folder only if no snapshot exists (pre-engine legacy feature with no engine dir).

**2. `lib/feature-dependencies.js` lines 560-584 — `checkUnmetDependencies()`**

Determines whether a dependency is met by `entry.folder === '05-done'`. If engine says `lifecycle: done` but spec is elsewhere, the dependency is treated as unmet and the dependent feature is blocked indefinitely.

Fix: read engine snapshot for each dependency; use `snapshot.lifecycle === 'done'` as the met condition. Fall back to `folder === '05-done'` only for features with no engine dir (pre-engine legacy).

**3. `lib/analytics.js` lines 338-437 — `buildFeatureAnalytics()`**

Enumerates completed features exclusively by scanning `05-done/`. Features that are `lifecycle: done` in the engine but whose spec is missing or elsewhere are silently absent from all analytics.

Fix: enumerate from engine dirs (`.aigon/workflows/features/`) filtered by `snapshot.lifecycle === 'done'`. UNION with `05-done/` folder scan to catch legacy pre-engine features. Deduplicate by ID.

### MODERATE — wrong data shown, wrong entities located

**4. `lib/board.js` lines 34-99 — `collectBoardItems()`**

Falls back to folder position as displayed stage when engine snapshot is missing. Pre-start entities legitimately lack snapshots and are correctly handled by `buildMissingSnapshotState` — preserve this. The bug is when a started feature has a missing snapshot: it should show as `WORKFLOW_SOURCE.MISSING_SNAPSHOT`, not silently inherit folder position as stage.

Fix: distinguish "no snapshot because pre-start" (folder fallback correct) from "no snapshot because drift/corruption" (show `MISSING_SNAPSHOT`). Use the presence of an engine dir as the discriminator: engine dir exists but no snapshot → `MISSING_SNAPSHOT`; no engine dir → pre-start, folder fallback correct.

**5. `lib/dashboard-status-collector.js` lines 125-146 — `collectDoneSpecs()`**

Collects "recent completions" for dashboard display by scanning `05-done/` only. Misses engine-done features with missing or moved specs.

Fix: enumerate from engine snapshots filtered to `lifecycle: done`, sorted by snapshot completion timestamp. Retain `05-done/` scan as supplementary source for legacy features without engine dirs. Deduplicate by ID.

**6. `lib/entity.js` lines 690-787 — `pausePrestartEntity()` / `resumePrestartEntity()`**

Locates entities by scanning expected folders before consulting the engine. Correct for pre-start entities with no snapshot, but should validate against snapshot if one exists.

Fix: attempt snapshot lookup first via `featureSpecResolver.resolveEntitySpec()`; use canonical spec path from engine state. Fall back to folder scan only for pre-start entities with no engine snapshot.

**7. `lib/entity.js` lines 480-505 — drift correction in `entityCloseFinalize()`**

Silently force-moves specs to `05-done/` if engine has closed but spec is in wrong folder. Masking drift bugs rather than surfacing them means the underlying cause is never found.

Fix: keep the correction but emit `console.warn` with enough detail to diagnose the source of drift. Record a `spec.drift_corrected` workflow event so drift is observable in the event log.

### LOW — cosmetic/precision only

**8. `lib/feature-dependencies.js` lines 284-305 — `stageFromFolder()` in graph rendering**

Uses folder position to colour dependency graph nodes. Cosmetic only.

Fix: read snapshot lifecycle for node colour. Low priority, can be done last.

**9. `lib/analytics.js` line 437 — file mtime as completion timestamp fallback**

Uses `fs.statSync().mtime` as completion date when no engine event timestamps exist. Inaccurate if file was touched post-completion.

Fix: read completion timestamp from `feature.closed` event in the event log. File mtime as last resort only.

## Shared helper to extract

Every critical fix needs the same logic: "for entity ID X, is it done?" Extract this into a single shared helper in `lib/workflow-core/` to avoid re-implementing at each call site:

```javascript
// lib/workflow-core/entity-lifecycle.js (new file or addition to existing)
function isEntityDone(repoPath, entityType, id, folderFallback) {
    const snapshot = readSnapshotSync(repoPath, entityType, id);
    if (snapshot) return snapshot.lifecycle === 'done';
    // No snapshot: pre-start or pre-engine legacy — use folder fallback explicitly
    return folderFallback === '05-done';
}
```

Pass `folderFallback` as the folder name found during the scan, so callers are explicit about what they're falling back to.

## Acceptance Criteria

- [ ] `set-conductor.js`: engine snapshot checked first; folder fallback explicit and only for features with no engine dir; existing set progression tests pass.
- [ ] `feature-dependencies.js` (`checkUnmetDependencies`): engine snapshot used to determine met/unmet; features correctly unblocked when `lifecycle: done` regardless of spec folder position; features with no engine dir fall back to `folder === '05-done'`.
- [ ] `analytics.js`: completed feature list is UNION of engine-done features + legacy `05-done/` scan; no engine-done feature is absent from analytics output.
- [ ] `board.js`: pre-start entities (no engine dir) continue to show via `buildMissingSnapshotState`; started entities with missing snapshot show `WORKFLOW_SOURCE.MISSING_SNAPSHOT`, not their folder stage.
- [ ] `dashboard-status-collector.js`: recent completions sourced from engine snapshots + legacy folder supplementary; sorted by engine completion timestamp.
- [ ] `entity.js` drift correction: emits `console.warn` with full context; records `spec.drift_corrected` workflow event.
- [ ] Shared `isEntityDone()` helper extracted and used by at least violations 1, 2, and 3.
- [ ] All existing tests pass. No regressions to inbox/backlog synthetic state or pre-engine legacy feature handling.
- [ ] New unit tests:
  - Dependency met when engine says `lifecycle: done` but spec not in `05-done/`
  - Dependency unmet when engine says `lifecycle: in-progress` even if spec somehow in `05-done/`
  - Analytics includes engine-done feature whose spec file is missing
  - Set conductor advances past engine-done member whose spec drifted from `05-done/`
  - Board shows `MISSING_SNAPSHOT` for started feature with missing snapshot (not folder stage)

## Technical approach

Read path for each fix: `readSnapshotSync(repoPath, entityType, id)` from `lib/workflow-core/` (or the equivalent adapter already used in `lib/feature-workflow-rules.js`). Check whether an engine dir exists at `.aigon/workflows/{entityType}s/{id}/` to distinguish pre-start (no dir) from drift (dir exists, no snapshot).

Enumeration path for analytics and dashboard: `fs.readdirSync('.aigon/workflows/features/')` gives all IDs that have ever been started. Filter by reading each snapshot. Union with folder scan for IDs present in `05-done/` but absent from engine dirs (legacy).

## Validation

```bash
node --check lib/set-conductor.js
node --check lib/feature-dependencies.js
node --check lib/analytics.js
node --check lib/board.js
node --check lib/entity.js
node --check lib/dashboard-status-collector.js
npm test
```

## Pre-authorised

- May add `isEntityDone()` and related helpers to `lib/workflow-core/` without a separate refactor feature.
- May add new unit tests for corrected behaviours; may raise `scripts/check-test-budget.sh` CEILING by up to +80 LOC.
- May emit `console.warn` and record `spec.drift_corrected` workflow events in drift correction paths.

## Dependencies

- `getNextId` fix already shipped in commit d1dc2f81 — do not redo.

## Out of scope

- Retroactive migration of legacy pre-engine features into the engine — `aigon doctor --fix` handles this separately.
- SQLite / database migration — separate architectural decision.
- Feedback entity state (`spec-reconciliation.js`) — feedback uses folder-as-state by design, not workflow-core engine.

## Related

- Audit performed 2026-04-27 during backup/sync architecture discussion
- `getNextId` root cause: F380 was completed autonomously during a conversation; `getNextId` didn't scan engine dirs so didn't see the completed ID — fixed in commit d1dc2f81
- F294: introduced `WORKFLOW_SOURCE.MISSING_SNAPSHOT` — the correct state for started features with missing snapshots; board.js fix should use this constant
