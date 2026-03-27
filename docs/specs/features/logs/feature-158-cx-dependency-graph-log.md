# Implementation Log: Feature 158 - dependency-graph
Agent: cx

## Plan
- Add dependency graph generation utilities to `lib/entity.js` that:
  - Build ancestor/descendant subgraphs for each feature
  - Render inline SVG dependency graphs with stage-aware node colors
  - Upsert/remove a managed `## Dependency Graph` section in specs
- Refresh dependency graphs automatically on:
  - `feature-prioritise`
  - `feature-start`
  - `feature-close`

## Progress
- Implemented SVG graph generation and spec-section upsert logic in `lib/entity.js`.
- Added `refreshFeatureDependencyGraphs()` and wired it into `entityPrioritise()` for feature specs.
- Hooked graph refresh into `feature-start` after backlog→in-progress move.
- Hooked graph refresh into `feature-close` after moving spec to done.
- Ran syntax checks:
  - `node -c lib/entity.js`
  - `node -c lib/commands/feature.js`
- Ran a temp-fixture runtime validation to confirm graph insertion/removal behavior.

## Decisions
- Used inline SVG (not Mermaid) so spec rendering works directly in markdown viewers and dashboard markdown preview without additional frontend dependencies.
- Scoped graph rendering to participating features only:
  - A feature gets a graph if it has upstream dependencies or downstream dependents.
  - Features with no graph participation have no section.
- Implemented full-graph refresh per trigger to keep all affected connected specs in sync when stages or dependencies change.

## Code Review

**Reviewed by**: cc (Claude Opus 4.6)
**Date**: 2026-03-28

### Findings
- SVG marker ID `dep-arrow` was hardcoded — duplicate IDs cause arrow rendering failures when multiple graphs are in the same HTML document
- SVG text elements had no `font-family` — would render in browser default serif, not matching the dashboard's sans-serif UI
- `featureId` was unescaped in the SVG `aria-label` attribute (low risk since IDs are numeric, but defense-in-depth)

### Fixes Applied
- `fix(review): use unique SVG marker IDs and add font-family` — marker IDs now scoped per feature (`dep-arrow-{id}`), added `system-ui` font stack to SVG root, escaped `aria-label`

### Notes
- Implementation chose inline SVG over Mermaid (spec suggested either) — valid decision, avoids external dependency and works in raw markdown viewers
- All three trigger points (prioritise, start, close) are correctly wired
- `refreshFeatureDependencyGraphs` rebuilds the reverse graph for each feature — acceptable for typical project sizes but could be optimized if feature count grows large
- `feature-start` graph refresh only runs when `movedFromBacklog` is true — features restarted while already in-progress won't get a graph refresh (minor edge case)
- Agent left all work uncommitted — committed as part of review
