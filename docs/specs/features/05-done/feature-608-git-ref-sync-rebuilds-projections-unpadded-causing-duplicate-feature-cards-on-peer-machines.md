---
complexity: medium
set: git-backed-storage-hardening
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-03T13:20:34.687Z", actor: "cli/feature-prioritise" }
---

# Feature: git-ref sync rebuilds projections unpadded causing duplicate feature cards on peer machines

## Summary

In git-ref storage, a machine that reconstructs a prioritised feature purely from
canonical events (`storage sync` on a fresh peer clone) rebuilds the **local
workflow projection at an unpadded numeric id** (`.aigon/workflows/features/1/`),
while the spec file/folder synced via `main` uses the **zero-padded** convention
(`docs/specs/features/02-backlog/feature-01-…md`, id `01`). The dashboard status
collector then enumerates the feature **twice**: one "live" card from the
projection dir (`id=1`, has events) and one "empty" card from the spec file
(`id=01`, `workflowEventCount=0`). Every prioritised feature is duplicated on
every peer machine.

This is the sync-side complement to the padded-id fix in
`wip/numeric-projection-refs` (landed on main as `2cf1f4c15`): that fix made the
append/write path accept padded ids and route `projectionRef`, but the rebuild on
a peer with **no pre-existing padded projection dir** falls back to the unpadded
key (`projectionRefForKey('F1') → 'F1' → dir "1"`). F598's two-clone harness did
not catch it because it asserts event convergence, not the dashboard spec↔projection pairing.

## Reproduction (verified 2026-07-03)

Two git-ref clones of one origin (`specstore-taproom-a`, `specstore-taproom-b`):

1. On A: `feature-prioritise <slug>` → assigns id `01`, projection dir `01`,
   commits spec to `02-backlog/feature-01-…md`.
2. Propagate: `git push origin main` (spec) + `aigon storage sync` (events);
   on B: `git pull origin main` + `aigon storage sync`.
3. B's projection rebuilds at `.aigon/workflows/features/1/` (unpadded), spec at
   `feature-01-…`.
4. `/api/status` for B returns two rows for the same feature:
   - `[1]  F1 backlog  …feature-01-…md  evt=1`   (from projection dir)
   - `[01] F1 backlog  …feature-01-…md  evt=0`   (from spec file)

Deleting `.aigon/workflows` on B and re-syncing reproduces `1` (not `01`),
confirming it is current-code behaviour, not stale state.

## Acceptance Criteria

- [ ] After a peer `storage sync` with **no pre-existing local projection dir**,
      the rebuilt workflow dir uses the **padded** id (`01`, not `1`) — i.e.
      `.aigon/workflows/features/01/` exists and `.aigon/workflows/features/1/`
      does not.
- [ ] After that sync, `collectFeatures` (and therefore `/api/status`) returns
      exactly **one** row for the feature on the receiving clone — not one
      workflow-backed row plus one spec-only row with `workflowEventCount=0`.
- [ ] `aigon feature-status 01` on the receiving clone resolves the synced
      snapshot (not "no workflow-core snapshot").
- [ ] Fix holds for single-digit ids (`F1` → `01`) and multi-digit ids
      (`F10` → `10`); no regression when the originating machine already created
      a padded projection dir locally.
- [ ] F598's two-clone harness gains a **single-digit** scenario (feature `01` /
      key `F1`): clone A records events with a padded local dir, sync propagates
      to clone B with no local dir, and the harness asserts (a) padded rebuild
      path on B and (b) deduped feature count from `collectFeatures` — no
      browser/tmux required.

## Validation

```bash
node tests/unit/spec-store-git-ref.test.js
node tests/integration/two-clone-git-ref-storage.test.js
npm run test:related -- lib/spec-store lib/dashboard-status-collector.js lib/workflow-read-model.js
```

## Technical Approach

**Root cause (two layers):**

1. **Producer:** `projectionRefForKey` in `lib/spec-store/git-ref-backend.js` returns
   the bare canonical key (`F1`) when no padded local dir exists; `normalizeEntityRef`
   in `lib/spec-store/entity-ref.js` turns that into unpadded `entityId: "1"`, so
   `rebuildLocalProjection` writes `.aigon/workflows/features/1/`.
2. **Consumer:** `collectFeatures` in `lib/dashboard-status-collector.js` enumerates
   workflow dirs first, then spec files, and skips a spec row only when
   `workflowFeatureIds.has(featureId)` — a **string** match. `"1"` ≠ `"01"`, so
   both rows ship.

**Chosen fix (producer primary, read-side belt-and-suspenders):**

1. **Producer-side (required):** when deriving a workflow `entityId` from a
   numeric SpecStore key (`F{n}`), pad to the repo convention
   (`String(n).padStart(2, '0')`) before `rebuildLocalProjection`. Touch
   `projectionRefForKey` / `normalizeEntityRef` (or a small helper both call) so
   sync on a peer with no local dir rebuilds `01`, matching `feature-prioritise`
   on the origin machine. Canonical git-ref keys stay unpadded (`F1`).
2. **Read-side (required):** in `collectFeatures`, treat numeric feature ids as
   equivalent when deduping workflow dirs vs spec files (same pattern as
   `agent-status.readAgentStatus` and `setup-legacy` tmux cleanup). This covers
   any legacy unpadded dirs already on disk without a migration.
3. **Tests:** add a unit case in `spec-store-git-ref.test.js` for
   merge/rebuild-from-remote-only `F1` on a clean peer → dir `01`; extend F598
   harness with the single-digit sync scenario above.

Research topics use a different collector shape (spec-first, no workflow-dir
pre-pass) — **feature-only** unless the same padded/unpadded split is found there
during implementation.

**Execution order:** producer fix → collector dedup → unit test → F598 extension.

## Dependencies
- Set: git-backed-storage-hardening (follows F595–F599)

## Out of Scope
- Changing the canonical git-ref key format (`F1` unpadded stays).

## Related
- Set: git-backed-storage-hardening
- Prior features in set: F595, F596, F597, F598, F599
- Regression harness to extend: F598 (`tests/integration/two-clone-git-ref-storage.test.js`)
- Existing padded-id unit coverage (append/import, not peer rebuild):
  `tests/unit/spec-store-git-ref.test.js` — `git-ref appendEvent accepts zero-padded
  workflow ids`, `sync imports zero-padded local projection events into canonical keys`
