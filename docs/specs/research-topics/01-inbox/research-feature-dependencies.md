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
