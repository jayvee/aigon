# Research Findings: feature dependencies

**Agent:** Codex (cx)
**Research ID:** 20
**Date:** 2026-03-23

---

## Key Findings

- Aigon already has the right enforcement choke point in `feature-start`. `lib/commands/feature.js` resolves the target feature, runs pre-hooks, then calls `ctx.stateMachine.requestTransition(featureId, 'feature-start', ...)`. That makes `feature-start` the lowest-risk place to block or warn before worktrees/branches are created.
- Dependency data is not machine-readable today. The feature spec template only has a freeform `## Dependencies` markdown section in `templates/specs/feature-template.md`, so current dependency text cannot be enforced without brittle prose parsing.
- The repo already has a lightweight frontmatter parser that supports simple scalars and inline arrays. `lib/utils.js` exposes `parseFrontMatter()` and `parseYamlScalar()`, so a field like `depends_on: [121, 126]` fits existing parsing constraints without adding a YAML library.
- The manifest system is a good cache, but not the best source of authoring truth for dependency declarations. `feature-prioritise` currently writes a coordinator manifest with id, name, stage, spec path, agents, winner, and pending state. Adding dependency metadata there is useful for dashboard reads, but the spec should remain the source of truth because it travels with the feature and is reviewable in git.
- The dashboard can visualize blocked state cheaply. `lib/dashboard-server.js` already reads spec files plus `.aigon/state/feature-*.json` manifests to build feature cards, so adding a `blockedBy` label and disabling the start action is a small extension. Full dependency arrows would be a second phase.
- External tools all model dependencies as explicit relationships, not inferred prose:
  - Linear supports explicit blocked/blocking issue relations and shows them in sidebars; project dependencies also appear on timelines with visual indicators for violations.
  - GitHub Issues lets users mark work as blocked by or blocking other work, and blocked issues get a visible blocked icon on boards/issues views.
  - Jira uses explicit work item link types such as `blocks` and `is blocked by`, and Atlassian documents automation/queries built around those link relations.

### Options Evaluated

1. Parse the `## Dependencies` section automatically
   - Pros: no template/frontmatter change
   - Cons: current section is intentionally prose; parsing lists, comments, mixed IDs/slugs, and external prerequisites would be fragile
   - Verdict: not suitable for enforcement

2. Store dependencies only in manifest JSON
   - Pros: easy runtime reads; naturally close to state-machine checks
   - Cons: hidden from spec review, easy to drift from the markdown spec, awkward to edit manually
   - Verdict: good cache, bad authoring source

3. Add explicit frontmatter to feature specs and optionally mirror to manifest
   - Pros: versioned with the spec, easy to validate at `feature-prioritise`, easy to read at `feature-start`, fits existing parser
   - Cons: requires adding frontmatter to feature specs or teaching the CLI to insert it when missing
   - Verdict: best balance of simplicity and reliability

### Specific Answers To The Research Questions

- Where should dependencies be declared?
  - In explicit spec frontmatter, not in the freeform markdown section and not in a separate dependency map file.
  - Keep `## Dependencies` as the human explanation section.

- Hard block or soft warn?
  - Default to hard block in `feature-start`, with a `--force` escape hatch for exceptional cases.
  - Pure warnings are too easy to ignore and do not solve the workflow ordering problem this research is addressing.

- IDs, names, or both?
  - Store canonical IDs after prioritisation.
  - Allow slug/name references only as an authoring convenience before or during `feature-prioritise`, then resolve and rewrite them to IDs.

- What if a dependency is in-progress but not done?
  - Block by default.
  - Only `05-done` should satisfy a dependency.

- Should the board/dashboard visualize dependencies?
  - Yes, but keep phase 1 minimal: show `blocked by #NN` on cards and disable or warn on the start action.
  - Skip arrows/graph layout initially.

- How should circular dependencies be detected?
  - Run DFS/topological validation whenever dependencies are added/changed and before `feature-start`.
  - Block cycles at write time when possible; re-check at start time as a safety net.

- Should `feature-prioritise` validate dependency existence?
  - Yes. This is the right time to canonicalize references and reject missing feature IDs/slugs.

- What do other tools do?
  - Linear, GitHub, and Jira all use explicit link relations with UI surfacing for blocked items. None of them rely on parsing prose dependency sections.

- What is the simplest implementation that provides value?
  - Add `depends_on` frontmatter to feature specs.
  - Validate/canonicalize it in `feature-prioritise`.
  - Check it in `feature-start`.
  - Surface blocked state in board/dashboard textually.
  - Mirror canonical dependencies into the manifest only if the dashboard wants faster reads.

## Sources

- Repo:
  - `templates/specs/feature-template.md` (freeform `## Dependencies` section only)
  - `lib/utils.js` (`parseFrontMatter()`, `parseYamlScalar()`)
  - `lib/commands/feature.js` (`feature-prioritise`, `feature-start`)
  - `lib/dashboard-server.js` (manifest-backed feature card assembly)
- Linear project dependencies: https://linear.app/docs/project-dependencies
- Linear issue relations: https://linear.app/docs/issue-relations
- GitHub issue dependencies: https://docs.github.com/en/enterprise-cloud@latest/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies
- Atlassian work item linking: https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-linking/
- Atlassian JQL linked work item fields: https://support.atlassian.com/jira-work-management/docs/jql-fields/
- Atlassian automation example for blocking linked work: https://support.atlassian.com/jira/kb/prevent-linking-jira-work-items-if-parent-is-closed/

## Recommendation

Use explicit feature-spec frontmatter as the source of truth:

```yaml
---
depends_on: [121, 126]
---
```

Then implement the workflow in three narrow slices:

1. `feature-prioritise`
   - Read `depends_on` if present.
   - Resolve slug/name references to real feature IDs.
   - Reject missing references.
   - Reject cycles.
   - Rewrite the spec to canonical padded IDs.

2. `feature-start`
   - Before calling `requestTransition()`, resolve each dependency's current stage.
   - If any dependency is not in `05-done`, block with a clear message listing the unmet dependencies.
   - Allow override with `--force` so operators can intentionally bypass the guard.

3. Dashboard/board
   - Show blocked backlog items as `blocked by #NN`.
   - Disable or warn on start actions for blocked items.
   - Defer graph lines/arrows until the simple labels prove useful.

This keeps the implementation aligned with the current architecture:
- authoring lives in specs
- enforcement lives in commands
- state remains in manifests
- visualization stays lightweight

I do not recommend parsing `## Dependencies` automatically. Keep that section human-readable and optionally mention external or non-feature prerequisites there, but use `depends_on` for anything the CLI must enforce.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| feature-dependency-frontmatter | Add machine-readable `depends_on` frontmatter to feature specs and canonicalize values during prioritisation. | high | none |
| feature-start-dependency-gate | Block `feature-start` when required dependencies are not done, with a `--force` escape hatch. | high | feature-dependency-frontmatter |
| feature-dependency-cycle-validation | Detect and reject circular dependency graphs when dependencies are written or enforced. | medium | feature-dependency-frontmatter |
| dashboard-blocked-feature-state | Show blocked backlog items and dependency labels in the dashboard/board UI. | medium | feature-dependency-frontmatter |
| manifest-dependency-cache | Mirror canonical dependency IDs into feature manifests for cheaper dashboard reads. | low | feature-dependency-frontmatter |
