# Research Findings: feature dependencies

**Agent:** Claude (cc)
**Research ID:** 20
**Date:** 2026-03-23

---

## Key Findings

### Q1: Where should dependencies be declared?

**Recommendation: Spec frontmatter (`depends_on: [121, 126]`), mirrored to manifest for fast reads.**

Three options evaluated:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Parse `## Dependencies` markdown section | No template change needed | Brittle prose parsing; section mixes external prereqs, explanations, parentheticals | **Reject** — not machine-reliable |
| Store only in manifest JSON | Fast runtime reads; close to state machine | Hidden from code review; drifts from spec; awkward to hand-edit | **Reject** as sole source |
| Frontmatter in spec, mirrored to manifest | Versioned in git; reviewable; uses existing `parseFrontMatter()`; manifest gives fast dashboard reads | Requires frontmatter on specs (currently none have it) | **Accept** — best of both worlds |

Evidence: `lib/utils.js` already has `parseFrontMatter()` (line ~361) and `parseYamlScalar()` which handle simple scalars and inline arrays. A `depends_on: [121, 126]` field fits the existing parser without adding a YAML library.

The existing `## Dependencies` section should remain as human-readable context (external prereqs, explanations), while `depends_on` frontmatter handles machine enforcement.

### Q2: Hard block or soft warn?

**Recommendation: Hard block with `--force` override.**

| Approach | Used by | Problem for Aigon |
|----------|---------|-------------------|
| Pure visual flags (no enforcement) | Linear, Jira | Too easy to ignore; doesn't solve the ordering problem |
| Hard block (no override) | Make, Turborepo, Taskfile | Too rigid for project management; sometimes you need to scaffold ahead |
| Hard block + `--force` | npm (`--force`), proposed | Correct default prevents mistakes; escape hatch for intentional override |

Build tools (Make, Turborepo, Taskfile) universally use hard enforcement because incorrect ordering produces broken artifacts. Feature work is softer — you might want to scaffold a dependent feature while its prereq is in review — but the default should be safe. `--force` communicates intentionality.

### Q3: How should dependencies be expressed?

**Recommendation: Feature IDs (padded, e.g., `121`), with name-to-ID resolution at prioritise time.**

- IDs are canonical, stable, and unambiguous (no two features share an ID)
- Names can change, have typos, or be ambiguous before prioritisation
- Allow name/slug references as authoring convenience: `depends_on: [docs-merge-repos]` gets resolved and rewritten to `depends_on: [121]` during `feature-prioritise`
- Use padded IDs to match existing conventions (e.g., `feature-121-docs-merge-repos.md`)

### Q4: What happens when a dependency is in-progress but not done?

**Recommendation: Block by default. Only `05-done` satisfies a dependency.**

Rationale: A feature being "in progress" means its implementation isn't stable yet. Starting a dependent feature against an unstable foundation creates merge conflicts and rework. The `--force` override handles the legitimate case of parallel scaffolding.

Exception: `04-in-evaluation` could be considered "close enough" in some cases, but this adds complexity. Start strict, relax later if needed.

### Q5: Should the board/dashboard visualise dependencies?

**Recommendation: Yes, in two phases.**

**Phase 1 (ship with enforcement):**
- "Blocked by #121" label on backlog cards in both pipeline Kanban and monitor views
- Grey out or disable the "Start" action button for blocked features
- Show blocked count in board summary: `Backlog: 5 (2 blocked)`

**Phase 2 (separate feature, nice-to-have):**
- Dependency arrows between cards in pipeline view (SVG overlay)
- `aigon board --graph` CLI option outputting DOT format (Turborepo pattern)
- Highlight critical path (longest dependency chain)

The dashboard already reads spec files and manifests in `collectDashboardStatusData()` (`lib/dashboard-server.js` ~lines 502-924). Adding a `blockedBy` field to the feature object is a small extension.

### Q6: How do circular dependencies get detected?

**Recommendation: DFS cycle detection at write time, re-checked at start time.**

Implementation: Simple DFS traversal with a visited set. When `feature-prioritise` canonicalizes `depends_on`, build the full dependency graph from all specs and check for cycles. If a cycle is found, reject the dependency declaration with a clear error showing the cycle path.

```
Error: Circular dependency detected: 121 → 126 → 132 → 121
```

Re-check at `feature-start` as a safety net (specs could be edited manually between prioritise and start).

This is trivial to implement — ~20 lines of code. None of the PM tools (Linear, Jira, GitHub) do this well, but all build tools handle it. Aigon should.

### Q7: Should `feature-prioritise` validate that dependencies exist?

**Recommendation: Yes. This is the canonicalization checkpoint.**

`feature-prioritise` should:
1. Read `depends_on` from the spec being prioritised
2. Resolve names/slugs to IDs by scanning existing specs
3. Reject references to non-existent features
4. Check for cycles in the resulting graph
5. Rewrite the spec with canonical padded IDs

This prevents broken references from entering the backlog.

### Q8: How do other spec-driven tools handle this?

Comprehensive comparison:

| Tool | Declaration | Enforcement | Cycle Detection | Visualization |
|------|-------------|-------------|-----------------|---------------|
| **Linear** | UI relations (`blocks`/`blocked_by`) | Soft — flags only, no blocking | None | Colored flags on issues |
| **GitHub Projects** | No deps system (only sub-issues) | None | N/A | Progress bars only |
| **Jira** | Typed bidirectional links via API/UI | Soft — needs plugins for enforcement | None (needs plugins) | Link panel; Roadmaps arrows (Premium) |
| **Turborepo** | `dependsOn: ["^build", "lint"]` in JSON | Hard block | Via package graph | `--graph` DOT output |
| **Taskfile** | `deps: [lint, test]` in YAML | Hard block | Runtime error | None |
| **Make** | `target: prereq1 prereq2` | Hard block (unconditional) | Warns and drops one edge | None |
| **npm** | `dependencies: {"pkg": "^1.0"}` in JSON | Hard (graduated by type) | Tree flattening + partial exports | `npm ls` tree |
| **STM** | `dependencies: [ID]` in YAML frontmatter | Soft (warnings) | Not documented | None |
| **Taskwarrior** | `depends:<ID>` attribute | Soft (urgency scoring) | Not documented | Burndown charts |

**Key insight:** PM tools (Linear, Jira) universally use soft enforcement; build tools (Make, Turborepo) universally use hard enforcement. Aigon sits between — it's a development workflow tool, not a PM tool. Hard-with-override is the right middle ground.

### Q9: Simplest implementation that provides value?

**A single feature can deliver the core value:**

1. Add `depends_on` frontmatter field to feature spec template
2. Parse it in `feature-start` using existing `parseFrontMatter()`
3. Check each dependency's stage (scan `05-done/` for the spec file)
4. Block with clear message if unmet, allow `--force` override

That's ~40-60 lines of code in `feature-start`, using only existing utilities. No manifest changes, no dashboard changes, no new modules. This alone prevents the core problem.

### Q10: Parse `## Dependencies` automatically or use explicit frontmatter?

**Recommendation: Explicit frontmatter. Do not parse `## Dependencies` automatically.**

Evidence from existing specs:

```markdown
## Dependencies
- metrics-git-attribution (needs reliable AI/human commit classification)
```

```markdown
## Dependencies
- Feature: docs-content (site must have real content before going live)
```

```markdown
## Dependencies
- None (independent, but enriches metrics-insights-scorecard)
```

The format varies: some prefix with "Feature:", some have parenthetical explanations, some say "None" with qualifiers. This is valuable human context but unreliable for machine parsing.

Keep `## Dependencies` as documentation. Use frontmatter for enforcement.

## Sources

### Codebase
- `lib/utils.js` — `parseFrontMatter()`, `parseYamlScalar()`, `extractMarkdownSection()` (lines 361-431)
- `lib/manifest.js` — Manifest read/write, coordinator manifest schema (lines 1-250)
- `lib/commands/feature.js` — `feature-start` (lines 487-650), `feature-prioritise` (lines 341-397)
- `lib/dashboard-server.js` — `collectDashboardStatusData()` (lines 502-924)
- `lib/board.js` — Kanban and list view rendering (lines 132-313)
- `templates/specs/feature-template.md` — Current template with `## Dependencies` section
- `docs/specs/features/` — Existing specs with varied dependency formats

### External Tools
- Linear issue relations: https://linear.app/docs/issue-relations
- Linear project dependencies: https://linear.app/docs/project-dependencies
- GitHub issue dependencies: https://docs.github.com/en/enterprise-cloud@latest/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies
- Jira issue linking: https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-linking/
- Turborepo task dependencies: https://turborepo.dev/repo/docs/crafting-your-repository/configuring-tasks
- Taskfile dependencies: https://taskfile.dev/usage/#task-dependencies
- npm dependency resolution: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#dependencies

## Recommendation

**Use spec frontmatter as source of truth, enforce at `feature-start`, canonicalize at `feature-prioritise`.**

The implementation follows Aigon's existing architecture: authoring in specs, enforcement in commands, state in manifests, visualization in dashboard. No new modules or patterns needed.

**Spec format:**
```yaml
---
depends_on: [121, 126]
---
# Feature: my-feature
...
```

**Three-phase rollout:**

1. **Phase 1 — Core enforcement** (high priority, ~60 lines):
   - Parse `depends_on` from spec frontmatter in `feature-start`
   - Block if any dependency not in `05-done/`
   - `--force` flag to override
   - Clear error: `Feature 132 is blocked by: #121 (docs-merge-repos) [in-progress], #126 (aade-extract) [backlog]`

2. **Phase 2 — Canonicalization** (high priority, ~80 lines):
   - `feature-prioritise` resolves names → IDs in `depends_on`
   - Validates referenced features exist
   - DFS cycle detection (~20 lines)
   - Rewrites spec with canonical IDs

3. **Phase 3 — Visualization** (medium priority):
   - Mirror `depends_on` to manifest for fast dashboard reads
   - "Blocked by #121" labels on dashboard cards
   - Disable start action for blocked features
   - Board summary shows blocked count

**Why not a separate dependency map file?** It adds a centralization point that can drift from specs. Dependencies belong with the feature they describe, just like acceptance criteria do.

**Why not manifest-only?** Manifests are gitignored local state. Dependencies are architectural decisions that should be reviewed in PRs and versioned in git.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| feature-dependency-frontmatter | Add `depends_on` frontmatter field to feature specs and parse it with existing `parseFrontMatter()` | high | none |
| feature-start-dependency-gate | Block `feature-start` when declared dependencies are not in `05-done`, with `--force` override | high | feature-dependency-frontmatter |
| feature-prioritise-dependency-validation | Resolve name/slug references to canonical IDs, validate existence, detect cycles during `feature-prioritise` | high | feature-dependency-frontmatter |
| dashboard-blocked-feature-labels | Show "Blocked by #ID" labels on dashboard/board cards and disable start action for blocked features | medium | feature-start-dependency-gate |
| manifest-dependency-mirror | Mirror canonical `depends_on` from spec frontmatter into coordinator manifests for faster dashboard reads | low | feature-dependency-frontmatter |
| dependency-graph-cli | Add `aigon board --graph` option to output DOT-format dependency graph for visualization | low | feature-prioritise-dependency-validation |
