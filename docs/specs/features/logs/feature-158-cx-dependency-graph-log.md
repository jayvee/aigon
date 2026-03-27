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
