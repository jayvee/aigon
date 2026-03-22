# Feature: feature-dependency-graph-viz

## Summary
Add an interactive SVG dependency graph to the dashboard that visualizes feature dependency chains as a directed graph. Nodes represent features (colored by stage), directional edges show dependency relationships, blocked paths are highlighted in red, and edges animate/fade as features complete. Provides at-a-glance understanding of what's blocked, what's ready, and what the critical path is.

## User Stories
- [ ] As a developer, I want to see my feature dependency chains visualized as a graph so I can understand the critical path
- [ ] As a developer, I want blocked paths highlighted so I can see bottlenecks at a glance
- [ ] As a developer, I want the graph to update as features progress so I can see the chain unblocking in real-time

## Acceptance Criteria
- [ ] Dashboard has a "Dependencies" tab or toggle that shows the dependency graph
- [ ] Features render as nodes colored by stage (backlog=grey, in-progress=blue, done=green, blocked=red outline)
- [ ] Directed edges (arrows) show dependency relationships between features
- [ ] Blocked dependency paths are highlighted in red
- [ ] Completed dependencies fade or show a green checkmark on the edge
- [ ] Graph auto-layouts using a DAG (directed acyclic graph) algorithm — no manual positioning
- [ ] Clicking a node navigates to or highlights the feature in the pipeline view
- [ ] Graph handles 20+ features without visual clutter (zoom/pan or clustering)
- [ ] Works in the existing dashboard (vanilla HTML/JS + inline SVG, or lightweight library)

## Validation
```bash
node -c aigon-cli.js
```

## Technical Approach
- Render as inline SVG in the dashboard — no heavy framework needed since the dashboard is vanilla HTML/JS
- Use a lightweight DAG layout algorithm (e.g., Dagre-style topological layering) or a simple left-to-right Sugiyama layout
- Options for implementation:
  - **Option A**: Pure SVG with manual layout (~200-300 lines JS) — fits the dashboard's vanilla approach
  - **Option B**: Use a lightweight library like `elkjs` (ELK layout engine, runs in browser, ~150KB) for auto-layout, render to SVG
  - **Option C**: React component if dashboard migrates to React in future
- Data source: read `dependsOn` from coordinator manifests (already mirrored by feature-dependency-system)
- Color scheme: match existing dashboard stage colors
- WebSocket updates: leverage existing dashboard WebSocket for real-time graph updates when feature stages change

## Dependencies
- feature-dependency-system (provides `dependsOn` data in manifests)

## Out of Scope
- CLI graph output (DOT format) — may add later
- Cross-repo dependency visualization
- Critical path analysis / Gantt charts
- Editing dependencies from the graph UI

## Open Questions
- Should the graph show all features or only those with dependencies?
- Preferred layout direction: left-to-right or top-to-bottom?

## Related
- Research: research-20-feature-dependencies
- Upstream: feature-dependency-system
