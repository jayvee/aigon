# Implementation Log: Feature 517 - simplify-unified-entity-view
Agent: cc

## Status
Implemented (strangler pass 1). `buildEntityView` introduced + 3 consumers migrated. iterate gate green; live `/api/status` verified (13 repos / 858 features, blockedBy populated).

## New API Surface
`lib/read-model/entity-view.js#buildEntityView(repoPath, entityType, id, options)` → `{ id, type, lifecycle, stage, closed, blocked, blockedBy, agentRows, sessions, specPath, snapshotPath, complexity, set, criteria, name, source }`. Options: `snapshot`, `specPath`, `sessionService`, `folderFallback`, `specIndex`, `includeSessions`, `computeBlocked`, `featurePaths`, `dependencyChecker`. `sessions` facet = `{ live, byRole, primaryByRole }`.

## Key Decisions
- Lives in `lib/read-model/`, NOT workflow-core — it's an application read-model. Composes workflow-core via the public barrel + `workflow-snapshot-adapter` (low-level reader, explicitly allowed); sessions only via `lib/agent-sessions` (F554), never raw tmux.
- One snapshot / one spec / one session read per call. `complexity` + `set` + `criteria` + `name` all come from the single spec read (frontmatter), not a separate set index.
- `computeBlocked:false` breaks the `buildEntityView → checkUnmetDependencies → buildEntityView(dep)` recursion; the checker only needs each dep's own `closed`/`stage`.
- `includeSessions:false` keeps hot paths (dashboard) off the session enumeration; `specPath` override lets the dashboard reuse the already-known path with zero resolver cost.

## Gotchas / Known Issues
- `blockedBy` stage label is now the **coarse** stage (`in-progress`) via `snapshotToStage`, not the fine-grained `currentSpecState` (`implementing`). Updated the one assertion in `tests/integration/engine-first-folder-fallback.test.js`.
- `writeSnap(repo, kind, …)` keys the engine dir off `kind`: research snapshots are `.aigon/workflows/research/<id>` (pass `'research'`, not `'research-topics'`).

## Explicitly Deferred
- Deep `collectFeatures` consolidation (stage/agentRows/closed re-derivation through the view) — the spec's explicit "highest-risk, last" item. Only the backlog `blockedBy` annotation migrated this pass; net `lib/` LOC is roughly flat (entity-view adds ~250; deleted `collectIdentity`/`collectSpec` + dashboard mapping). Negative-LOC target lands when the remaining `workflow-read-model`/collector projections migrate.
- `feature-status` still uses raw-tmux `collectSession` for pid/uptime (CLI runtime detail, not canonical state). Identity/spec/lifecycle now come from the view.
- No `lib/workflow-service.js` facade introduced — direct `require('../workflow-core')` barrel sufficed; revisit if a consumer needs many `workflow-core/*` internals.

## For the Next Feature in This Set
F519 (actions.js split) and future read-path work: project from `buildEntityView` — do not re-read snapshots or re-derive closed/blocked/stage. Add new entity facets to the canonical shape once (resist per-consumer optional fields). When migrating `collectFeatures`, inject the already-read snapshot and pass `includeSessions:false` to avoid poll-cost regressions; the view's `isEntityDone` still does its own disk read, so add a cheaper `computeClosed:false` path if profiling shows it on the hot loop.

## Test Coverage
`tests/integration/entity-view.test.js` (11 tests): feature × every lifecycle stage, research, folder fallback, session facet (injected service), dependency blocked/unblocked. `engine-first-folder-fallback.test.js` + `lifecycle.test.js` pass. iterate gate (lint + scoped + browser smoke) green.
