# Feature: reconcile-spec-drift-from-ui

## Summary
After F272 was made detect-only on dashboard reads (`98ed172b`), the engine still detects when a spec file's visible folder disagrees with the workflow snapshot, but it no longer silently corrects it. This feature adds the "corrective" half back as an explicit user action per entity: a drift badge on feature/research cards, with a button to run the engine-wins reconciliation for that one entity. No blanket auto-heal, no cross-repo surprises — the user sees exactly which files will move and confirms one at a time.

## User Stories
- [ ] As a user, when a spec's folder drifts from its engine snapshot, I see a drift badge on the card in the dashboard (and in `aigon board`).
- [ ] As a user, clicking the drift badge shows me the current path and the engine-expected path, and lets me reconcile that one entity with one click.
- [ ] As a user, I never have files silently moved across repos on a dashboard refresh. Reconciliation is always an explicit per-entity action.
- [ ] As a power user, I can still set `AIGON_AUTO_RECONCILE=1` to restore F272's original auto-heal behaviour, or run `aigon repair <type> <id>` to reconcile from the CLI.

## Acceptance Criteria
- [ ] Dashboard API exposes `specDrift` on each feature/research entity: `null` when no drift, otherwise `{ currentPath, expectedPath, lifecycle }` — paths relative to the repo.
- [ ] Dashboard UI renders a drift badge on any card where `specDrift !== null`. Click opens a small popover with current/expected paths and a "Reconcile" button.
- [ ] "Reconcile" posts to a new `/api/spec-reconcile` endpoint (POST, body: `{ repoPath, entityType, entityId }`). The endpoint calls `reconcileEntitySpec(..., { dryRun: false })` and returns the result.
- [ ] `aigon board` with `--all` or on a single repo also shows the drift marker in its column display.
- [ ] No new auto-reconcile paths are introduced. The `workflow-read-model.js` dashboard hook stays dry-run unless `AIGON_AUTO_RECONCILE=1`.
- [ ] The reconcile endpoint is defined in the action registry (`lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js`) as an infra action with `bypassMachine: true` — consistent with CLAUDE.md rule 8.
- [ ] Permissions: reconciliation from the UI is refused if the target directory is outside `<repoPath>/docs/specs/` (already enforced in `reconcileEntitySpec` post-`cbe3aeba`, verified end-to-end through the endpoint).
- [ ] Drift detection boundary is explicit: drift is still detected on every dashboard read regardless of `AIGON_AUTO_RECONCILE`. Only the mutation step is gated by the env var. Detect-only is the default; auto-move is opt-in.
- [ ] Reconciler is idempotent under concurrent clicks: double-clicking the "Reconcile" button, or two browser tabs clicking simultaneously, results in at most one move and no errors. The second request sees the already-corrected state and returns `driftDetected: false`.
- [ ] Integration test hits `POST /api/spec-reconcile` with a crafted fixture where `expectedDir` resolves outside `<repoPath>/docs/specs/` and asserts the endpoint returns a non-mutating response (e.g. 400 or `skipped: 'expected-path-outside-docs'`) and the file on disk is unchanged.

## Validation
```bash
node --check aigon-cli.js
npm test
```

Manual scenarios:
- [ ] Snapshot says `done`, spec in `02-backlog/` → drift badge appears on card. Click reconcile → file moves to `05-done/`. Badge clears on next refresh.
- [ ] Click reconcile on an entity with destination already occupied (non-placeholder) → reconcile returns `skipped: 'destination-exists'`, UI shows a readable warning, no move.
- [ ] Set `AIGON_AUTO_RECONCILE=1`, restart server → files move automatically on read as before (back-compat).
- [ ] Legacy/missing-snapshot entities do not show drift badges (no snapshot, no drift to report).

## Technical Approach
- Extend `getBaseDashboardState` in `lib/workflow-read-model.js` to expose `specDrift` on the returned shape when `specReconciliation.driftDetected === true`. Strip to `{ currentPath, expectedPath, lifecycle }` relative paths.
- Surface `specDrift` through `lib/dashboard-status-collector.js` so it lands on every feature/research entity in `/api/status`.
- Add `RECONCILE_SPEC_DRIFT` action to the workflow-rules action registries. `bypassMachine: true`, category `INFRA`, visible only when `specDrift !== null`.
- Wire a new `POST /api/spec-reconcile` handler in `lib/dashboard-server.js` that resolves `repoPath` from the registered set, runs `reconcileEntitySpec`, and returns the result. No CLI change needed — `aigon repair` already does this from the CLI side.
- Dashboard frontend: update `templates/dashboard/js/pipeline.js` (and monitor view if applicable) to render the badge + popover. Use shadcn components per frontend-design rules.
- `lib/board.js` — add a `⚠ drift` suffix to affected list-view rows.

## Dependencies
- Builds on: F272 detect-only patch (`98ed172b`) — dashboard API already carries drift info from the read model.

## Out of Scope
- Bulk "reconcile all drift in repo X" action. V1 is strictly per-entity; bulk can come later if drift becomes common (likely rare once F270-272 stabilise).
- Cross-repo drift summaries in the top-level Monitor tab. Useful but not necessary for v1.
- Changing CLI `aigon repair` behaviour. It continues to work as-is.
- Replacing or deprecating `AIGON_AUTO_RECONCILE=1` env var. Kept as a power-user escape hatch.

## Open Questions
- Should the badge also show in `aigon board` kanban view, or only in list view? Kanban cards are small; a single `⚠` icon might be enough. Decide at implementation time.
- Should the popover let the user reveal WHY drift exists (show snapshot `lifecycle` and visible folder stage side-by-side)? Probably yes — helps diagnose stale snapshots vs stale folders.

## Related
- Research:
- Parent feature: `feature-272-single-source-3-self-healing-spec-reconciliation.md`
- Follow-up incident context: fixes `cbe3aeba`, `98ed172b` on main
