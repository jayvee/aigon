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

- [ ] After a peer `storage sync`, a prioritised feature renders as exactly **one**
      card on that peer's dashboard.
- [ ] Local projection dirs rebuilt from canonical events match the spec-file id
      convention (padded), OR the dashboard collector normalises feature ids
      numerically so `1` and `01` are the same entity (decide in Technical Approach).
- [ ] Fix holds for ids that are single-digit (`1`/`01`) and multi-digit; no
      regression for machines that created the feature locally (already padded).
- [ ] F598's two-clone regression harness is extended to assert single-card /
      no-duplicate rendering (or id-normalised entity count) on the receiving clone.

## Validation

```bash
node tests/unit/spec-store-git-ref.test.js
npm run test:related -- lib/spec-store lib/dashboard-status-collector.js lib/dashboard-storage.js
```

## Technical Approach

Two candidate fixes — pick one, note the trade-off:
- **Producer-side (projection rebuild):** pad the rebuilt projection dir id to the
  spec-file convention in the sync/import path (`rebuildLocalProjection` /
  `importLocalProjectionRefs` / `projectionRefForKey`), so peers match A.
- **Read-side (collector):** normalise feature ids numerically when pairing spec
  files to projections in `dashboard-status-collector` (and any other enumerator),
  so `1` and `01` collapse to one entity. Lower blast radius; likely the safer fix,
  but must cover every place that keys features by id string.

Prefer the read-side normalisation unless the padded-vs-unpadded split causes
problems beyond display (e.g. CLI `feature-status 1` vs `01`, lease keys).

## Dependencies
- Set: git-backed-storage-hardening (follows F595–F599)

## Out of Scope
- Changing the canonical git-ref key format (`F1` unpadded stays).

## Related
- Set: git-backed-storage-hardening
- Prior features in set: F595, F596, F597, F598, F599
- Regression harness to extend: F598 (two-clone git-ref storage)
