# Research: Feature Dependencies

## Context

Features often have dependencies: `docs-site-build` can't start until `docs-merge-repos` is done, `aade-free-tier` can't start until `aade-extract-to-private-package` is done. Currently there's no enforcement — a user can start any backlog feature regardless of whether its prerequisites are complete. The dependency information exists in spec files (under `## Dependencies`) but aigon doesn't read or enforce it.

This research investigates a lightweight way to enforce feature dependencies so that `feature-start` blocks (or warns) when dependencies aren't met.

## Questions to Answer

- [ ] Where should dependencies be declared? In the spec frontmatter, in the manifest, in a separate dependency map file, or derived from the `## Dependencies` section of the spec?
- [ ] Should enforcement be hard (block `feature-start`) or soft (warn but allow override with `--force`)?
- [ ] How should dependencies be expressed? By feature ID (`depends-on: 121`), by feature name (`depends-on: docs-merge-repos`), or both?
- [ ] What happens when a dependency is in-progress but not done? Block, warn, or allow?
- [ ] Should the board/dashboard visualise dependencies? (e.g., greyed-out backlog items, dependency arrows, "blocked by #121" label)
- [ ] How do circular dependencies get detected and prevented?
- [ ] Should `feature-prioritise` validate that dependencies exist (i.e., the referenced feature IDs are real)?
- [ ] How do other spec-driven tools handle this? (Linear, Jira, GitHub Projects — but keep it lightweight)
- [ ] What's the simplest implementation that provides value? Could it be as simple as a `depends_on` field in the manifest checked by `feature-start`?
- [ ] Should the `## Dependencies` section in specs be parsed automatically, or should there be explicit machine-readable frontmatter?

## Scope

### In Scope
- Dependency declaration format and location
- Enforcement in `feature-start` (and possibly `feature-prioritise`)
- Dashboard/board visualisation of blocked features
- Detection of circular dependencies
- Integration with existing spec and manifest systems

### Out of Scope
- Cross-repo dependencies (e.g., aigon depends on aigon-pro)
- Research topic dependencies (research doesn't use manifests)
- Automatic dependency inference from code (too complex)
- Full project management / Gantt chart / critical path analysis

## Inspiration

- The docs feature chain: merge-repos → site-build → content → go-live
- The AADE chain: extract-to-private → free-tier → pro-tier → licensing
- Linear's "blocking/blocked by" relationships (simple, bidirectional)
- The `## Dependencies` section already in every spec template

## Recommendation

**Use spec frontmatter as source of truth, enforce at `feature-start`, canonicalize at `feature-prioritise`.**

All three agents (Claude, Gemini, Codex) reached consensus on the core design:

- **Declaration**: `depends_on: [121, 126]` in spec YAML frontmatter, using existing `parseFrontMatter()` from `lib/utils.js`
- **Do NOT parse `## Dependencies`** — too varied/prose-like for machine parsing; keep as human context
- **Reference by feature ID** — canonical padded IDs; allow name/slug as authoring convenience, resolved to IDs during `feature-prioritise`
- **Only `05-done` satisfies a dependency** — in-progress is not enough
- **Hard block + `--force` override** at `feature-start` (2 of 3 agents; Gemini preferred soft warn but the hard-with-override pattern matches build tools and prevents real mistakes while keeping an escape hatch)
- **DFS cycle detection** at write time (`feature-prioritise`) and re-checked at `feature-start`
- **Dashboard labels** — "Blocked by #ID" text on cards, disable start action; defer graph arrows to Phase 2
- **Manifest mirroring** — mirror canonical `depends_on` into coordinator manifests for faster dashboard reads

**Spec format:**
```yaml
---
depends_on: [121, 126]
---
# Feature: my-feature
...
```

**Two-phase rollout:**

1. **Phase 1 — Dependency system** (high priority): Add `depends_on` frontmatter to specs, canonicalize slug→ID at `feature-prioritise`, DFS cycle detection, manifest mirroring
2. **Phase 2 — Enforcement & visibility** (high priority): Block `feature-start` when deps unmet (`--force` override), "Blocked by #ID" labels on dashboard/board, disable start action for blocked features

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| feature-dependency-system | Add `depends_on` frontmatter to feature specs; parse with existing `parseFrontMatter()`; canonicalize slug→ID during `feature-prioritise`; DFS cycle detection; mirror to manifests for dashboard reads | high | `aigon feature-create "feature-dependency-system"` |
| feature-dependency-enforcement | Block `feature-start` when declared dependencies are not in `05-done` (with `--force` override); show "Blocked by #ID" labels on dashboard/board cards; disable start action for blocked features | high | `aigon feature-create "feature-dependency-enforcement"` |
| feature-dependency-graph-viz | Interactive SVG dependency graph in dashboard — render feature nodes with directional edges showing dependency chains, highlight blocked paths in red, animate resolution as features complete; implemented as a React component or inline SVG overlay on the pipeline view | low | `aigon feature-create "feature-dependency-graph-viz"` |

### Feature Dependencies
- feature-dependency-enforcement depends on feature-dependency-system
- feature-dependency-graph-viz depends on feature-dependency-system

### Not Selected
- dependency-graph-cli (`aigon board --graph` DOT output): Superseded by the richer feature-dependency-graph-viz which provides the same insight in the dashboard directly
