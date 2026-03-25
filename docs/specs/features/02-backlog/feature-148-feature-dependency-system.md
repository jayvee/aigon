# Feature: feature-dependency-system

## Summary
Add machine-readable `depends_on` frontmatter to feature specs, parse it with existing `parseFrontMatter()`, canonicalize slug/name references to padded IDs during `feature-prioritise`, detect circular dependencies via DFS, and mirror canonical dependencies into coordinator manifests for fast dashboard reads.

## User Stories
- [ ] As a developer, I want to declare feature dependencies in spec frontmatter so that the tooling can enforce ordering
- [ ] As a developer, I want to reference dependencies by name or slug and have them auto-resolved to IDs during prioritisation
- [ ] As a developer, I want circular dependencies to be detected and rejected before they cause problems

## Acceptance Criteria
- [ ] Feature specs support `depends_on: [121, 126]` in YAML frontmatter
- [ ] `parseFrontMatter()` correctly parses inline arrays of IDs
- [ ] `feature-prioritise` resolves name/slug references to canonical padded IDs and rewrites the spec
- [ ] `feature-prioritise` rejects references to non-existent feature IDs
- [ ] `feature-prioritise` detects circular dependencies via DFS and rejects with clear error message showing the cycle path (e.g., `121 -> 126 -> 132 -> 121`)
- [ ] Canonical `depends_on` is mirrored into coordinator manifest JSON for dashboard reads
- [ ] Existing `## Dependencies` section remains unchanged (human-readable context only)
- [ ] `node -c aigon-cli.js` passes

## Validation
```bash
node -c aigon-cli.js
```

## Technical Approach
- Use existing `parseFrontMatter()` and `parseYamlScalar()` from `lib/utils.js` (no new YAML library)
- Canonicalization happens in `feature-prioritise` (`lib/commands/feature.js` ~lines 341-397): read `depends_on`, scan spec folders to resolve names to IDs, run DFS cycle check, rewrite spec with padded IDs
- Cycle detection: simple DFS with visited set (~20 lines), builds full graph from all specs
- Manifest mirroring: add `dependsOn` field to coordinator manifest in `lib/manifest.js`
- The `## Dependencies` markdown section is NOT parsed — it remains documentation only

## Dependencies
- None (independent, foundational feature)

## Out of Scope
- Enforcement at `feature-start` (see feature-dependency-enforcement)
- Dashboard/board visualization (see feature-dependency-enforcement, feature-dependency-graph-viz)
- Cross-repo dependencies
- Research topic dependencies

## Open Questions
- None (resolved by research-20)

## Related
- Research: research-20-feature-dependencies
- Downstream: feature-dependency-enforcement, feature-dependency-graph-viz
