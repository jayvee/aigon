# Feature: Split entity.js extract feature dependency graph

## Summary

`lib/entity.js` (869 lines) bundles two unrelated concerns: ~30% is genuinely shared lifecycle helpers used by both feature and research commands (`entityCreate`, `entityPrioritise`, `entitySubmit`, `entityCloseFinalize`, `createFleetSessions`), and ~70% is feature-specific dependency-graph logic (`buildFeatureIndex`, `buildDependencyGraph`, `detectCycle`, `buildFeatureDependencySvg`, `refreshFeatureDependencyGraphs`, `resolveDepRef`, `rewriteDependsOn`) that no research command ever calls. Extract the graph functions into `lib/feature-dependencies.js` so the boundary between "shared lifecycle" and "feature-only graph code" becomes visible in the file structure.

## Acceptance Criteria

- [ ] New file `lib/feature-dependencies.js` exports the 7 graph functions
- [ ] `lib/entity.js` no longer contains graph code; targets ~250 lines (down from 869)
- [ ] Importers updated: `lib/commands/feature.js`, `lib/feature-close.js`, `lib/dashboard-server.js`, and `entity.js` itself (the prioritise flow uses `buildDependencyGraph` internally)
- [ ] `node -c` passes for all touched files
- [ ] Feature dependency SVG still renders in the dashboard (verify with Playwright screenshot)
- [ ] `aigon feature-prioritise <name>` still detects cycles and rewrites `depends_on` correctly

## Validation

```bash
node -c lib/entity.js
node -c lib/feature-dependencies.js
node -c lib/commands/feature.js
node -c lib/feature-close.js
node -c lib/dashboard-server.js
```

## Technical Approach

1. Create `lib/feature-dependencies.js` and move these functions verbatim from `entity.js`:
   - `buildFeatureIndex`
   - `resolveDepRef`
   - `buildDependencyGraph`
   - `detectCycle`
   - `rewriteDependsOn`
   - `buildFeatureDependencySvg`
   - `refreshFeatureDependencyGraphs`
2. Update imports in the four consumers — `commands/feature.js`, `feature-close.js`, `dashboard-server.js`, and inside `entity.js` itself (the prioritise flow).
3. Restart `aigon server` and verify the feature dependency graph still renders.

## Dependencies

- None

## Out of Scope

- Renaming any of the extracted functions
- Changing the dependency-graph algorithm or SVG output
- Splitting `commands/feature.js` (separate concern)
- Changing how research handles dependencies (still none today)

## Open Questions

- Should `feature-dependencies.js` re-export from `entity.js` for backward compat, or break imports cleanly? (Recommendation: clean break — only 4 importers, all in this repo)

## Related

- Modularity Review: `docs/modularity-review/2026-04-06/modularity-review.md` — Issue 2 (Significant)
- Source module: `lib/entity.js`
- Consumers: `lib/commands/feature.js`, `lib/feature-close.js`, `lib/dashboard-server.js`
