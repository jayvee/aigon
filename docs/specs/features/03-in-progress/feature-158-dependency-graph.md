# Feature: dependency-graph

## Summary

When a feature participates in a dependency graph (it depends on other features, or other features depend on it), render an SVG dependency graph visualization at the bottom of the feature spec file. In the dashboard, the graph should be visible when viewing the spec markdown in the Peek panel or spec drawer, rendered inline if the viewer supports SVG.

## User Stories

- [ ] As a user reading a feature spec, I want to see a visual dependency graph at the bottom showing what this feature depends on and what depends on it, so I can understand the execution order at a glance
- [ ] As a user viewing a feature in the dashboard, I want the dependency graph to render inline in the spec viewer so I don't have to open the file separately

## Acceptance Criteria

- [ ] Features with `depends_on` frontmatter get an SVG dependency graph appended/embedded at the bottom of the spec
- [ ] The graph shows the current feature highlighted, its upstream dependencies, and any downstream dependents
- [ ] Each node in the graph shows feature ID, name, and current stage (color-coded: green=done, blue=in-progress, gray=backlog, etc.)
- [ ] The graph updates when dependencies change (re-generated on `feature-prioritise`, `feature-start`, or `feature-close`)
- [ ] The SVG renders correctly in the dashboard spec drawer / Peek panel
- [ ] Features with no dependencies show no graph (no empty section)
- [ ] The graph handles chains (A → B → C) and fan-out/fan-in patterns

## Validation

```bash
node -c lib/entity.js
node -c lib/commands/feature.js
```

## Technical Approach

### Graph generation
- Use `buildDependencyGraph()` from `lib/entity.js` (already builds the full graph from frontmatter)
- For a given feature, extract its subgraph: all ancestors (transitive deps) and all descendants (transitive dependents)
- Generate SVG using a lightweight approach:
  - Option A: Generate Mermaid syntax and embed as a fenced code block (renderers like GitHub, dashboard marked+mermaid support it)
  - Option B: Generate raw SVG programmatically (no external dependency, but more code)
  - Option C: Use a simple DOT-like layout algorithm to position nodes in a top-down flow

### Recommended: Mermaid
Mermaid is the simplest — the dashboard already uses `marked` for markdown rendering, and Mermaid support can be added with a single script tag. The graph would be a fenced code block:

```
```mermaid
graph TD
    F05["#05 onboarding flow<br/>backlog"] --> F08["#08 beer style filters<br/>in-progress"]
    F08 --> F10["#10 advanced search<br/>backlog"]
    style F08 fill:#3b82f6,color:#fff
```​
```

### Injection points
- `feature-prioritise` — when a feature gets an ID and enters the pipeline, generate/update the graph section
- `feature-close` — update dependent features' graphs (upstream dep now done)
- `feature-start` — refresh graph to show current stages
- Could also regenerate on any `requestTransition()` via a post-transition hook

### Dashboard rendering
- The spec drawer and Peek panel render markdown via `marked` — add Mermaid rendering support
- Use `mermaid` CDN script with lazy initialization on code blocks with `language-mermaid`

### Key files
- `lib/entity.js` — `buildDependencyGraph()`, `resolveDepRef()`, graph utilities
- `lib/commands/feature.js` — `feature-prioritise`, `feature-close` (injection points)
- `templates/dashboard/js/spec-drawer.js` or `peek.js` — markdown rendering with Mermaid support
- `templates/dashboard/index.html` — Mermaid script inclusion

## Dependencies

- depends_on: feature-dependency-system (feature 148, already done)

## Out of Scope

- Interactive graph (click to navigate to feature) — future enhancement
- Cross-repo dependency graphs
- Automatic dependency detection (still manual `depends_on` frontmatter)
- Research topic dependency graphs

## Open Questions

- Should the graph be embedded directly in the markdown file (persisted) or generated on-the-fly when viewing?
- If embedded, should it be a Mermaid code block or inline SVG?

## Related

- Feature 148: feature dependency system (done) — provides `buildDependencyGraph()`, `depends_on` frontmatter, cycle detection
- Existing inbox specs: `feature-feature-dependency-enforcement.md`, `feature-feature-dependency-graph-viz.md` (may overlap — consolidate?)
