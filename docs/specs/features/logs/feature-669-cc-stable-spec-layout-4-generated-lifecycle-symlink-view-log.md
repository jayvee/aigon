# Implementation Log: Feature 669 - stable-spec-layout-4-generated-lifecycle-symlink-view
Agent: cc

## Status
Core complete. One idempotent projector generates lifecycle folders as local, disposable relative
symlinks into canonical `00-specs`; a CLI + refresh hooks + full unit/integration coverage ship.
The projector is gated on `specLayout: stable`, so it is a no-op on the current legacy tree until the
670 cutover flips the layout.

## New API Surface
- `lib/spec-view.js`:
  - `computeDesiredView(repoPath)` — pure `{linkPath → relativeTarget}` map + per-entity diagnostics
    from current snapshots + canonical identities. Never writes.
  - `reconcileView(repoPath, {dryRun})` — idempotent reconcile; returns `{created, replaced, removed,
    kept, blocked, managed, desiredCount}`.
  - `refreshView(repoPath, opts)` — safe entry; skips under legacy layout; never throws for collisions.
  - `isManagedLink` / `listManagedLinks` — lstat/readlink-only managed-link proof.
  - `readManifest`, `MANIFEST_REL` (`.aigon/state/spec-view-manifest.json`), `DIAG` codes.
- `aigon spec-view status | refresh` (`lib/commands/spec-view.js`; registered in `commands/infra.js`).

## Key Decisions
- **Managed = provable, not remembered.** A path is only touched if it is a *relative* symlink whose
  target lexically resolves to a direct child of the matching kind's `00-specs`. The manifest is purely
  diagnostic — deleting it and rebuilding reproduces the identical view (reconciliation reads disk state,
  never the manifest, and never an event ledger). This is what makes the projector idempotent.
- **Desired basename** prefers the real canonical file; falls back to `snapshot.specPath` basename so a
  checkout without local content still exposes a clearly-diagnosable *broken* (dangling) link
  (`managed[].broken = true`) rather than silently dropping the entity.
- **Git exclusion via `info/exclude`**, not tracked `.gitignore` churn. Generated links are written into
  the repo's local (per-worktree via `git rev-parse --git-path`) exclude block between markers, keeping
  the working tree/index/HEAD unchanged. The manifest lands under the already-ignored `.aigon/state/`.
- **Refresh never rolls back canonical state.** All three wired call sites (`spec-layout migrate`,
  `storage sync`, `storage doctor --fix`) call `refreshView` inside try/catch and only *warn* with a
  repair command (`aigon spec-view refresh`) on failure.
- Collisions (regular file, unmanaged/out-of-root symlink, duplicate canonical identity, content
  unavailable) block *that entity only* and surface a structured `DIAG` diagnostic; nothing is
  overwritten or deleted.

## Gotchas / Known Issues
- Pre-existing (not caused by 669): `tests/integration/spec-author-provenance.test.js` two `--agent`
  cases fail identically on the base tree (stale slug-path snapshot reads since 667 numbered creates —
  documented in the 668 log). Confirmed via `git stash` on the base tree.

## Explicitly Deferred
- Refresh is wired at the storage/migration command choke points. The remaining acceptance triggers —
  local lifecycle persistence (`feature-start`/pause/resume/close `move_spec` effects), `aigon apply`,
  and the dashboard storage-projection refresh path — are **not** yet wired. The shared `refreshView`
  API is ready; the cutover member (670) owns flipping the layout and should call it from the lifecycle
  `move_spec` effect executor so links track stage changes in real time.
- Tracked per-stage `.gitignore`/README metadata in the lifecycle folders is a cutover concern (adding it
  now, under legacy layout, would untrack the real specs still living in those folders).

## For the Next Feature in This Set (670 — cutover)
- After `spec-layout migrate --stable` the view is already built (migrate calls `refreshView`). For
  ongoing correctness, call `require('./spec-view').refreshView(repoPath)` from the lifecycle
  `move_spec` effect site so a start/pause/close immediately re-points links.
- Under stable layout the spec's file location is fixed at `00-specs`; the stage folder holds only the
  generated symlink. Direct-scan dependency/set scanners and `lib/dashboard-spec-index.js` (still
  stage-folder-keyed per 668's deferral) can either read `00-specs` directly or follow the view links.
- The projector treats `snapshot.currentSpecState || snapshot.lifecycle` as the stage source via
  `paths.LIFECYCLE_TO_{FEATURE,RESEARCH}_DIR` — reuse those maps, do not re-derive.

## Test Coverage
- `tests/integration/spec-view-projection.test.js` (8 tests): create/project with feature+research
  parity; idempotent rebuild after manifest deletion; stage-change replace + obsolete removal;
  broken/dangling link from snapshot metadata when content is missing; regular-file collision preserved;
  out-of-root unmanaged symlink preserved; duplicate canonical identity blocked; legacy-layout no-op.
- Verified in a real git repo that a view refresh leaves `git status` clean (link excluded via
  `info/exclude`, manifest under ignored `.aigon/state/`).
