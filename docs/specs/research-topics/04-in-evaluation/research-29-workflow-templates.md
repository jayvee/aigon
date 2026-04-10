# Research: Workflows (Custom Aigon Workflows)

## Context

When starting a feature autonomously, users must specify the agent combination, review strategy, and stop-after phase each time. For users with established patterns (e.g., "implement with Cursor, review with Claude Code, close automatically"), re-entering these parameters is tedious and error-prone.

**Workflows** would let users define named, reusable configurations that feed directly into `feature-autonomous-start`. Today the workflow is fairly linear (one implementation round, one optional review, then close), but as multi-round workflows become possible (implementation, review, counter-review, re-implementation), workflows will become the primary way users express complex orchestration without remembering flag combinations.

Calling these "Aigon workflows" (rather than templates, pipelines, or playbooks) gives the concept room to grow beyond just agent selection — workflows could eventually encompass PR creation, deployment triggers, notifications, or calls to external systems. A workflow is a user-defined customisation of the standard Aigon lifecycle.

The initial scope should be simple: let users select from pre-defined or user-created workflows that map to current `feature-autonomous-start` parameters. The research should also consider how the workflow model extends to richer multi-stage definitions in the future.

## Questions to Answer

### Naming
- [ ] Validate "workflow" as the user-facing term — does it conflict with internal `workflow-core` naming?
- [ ] What's the CLI surface? (`aigon workflow create`, `aigon workflow list`, `--workflow <name>`)
- [ ] How are individual workflows named by the user? (freeform slugs like `cursor-review-cc`, display names like "Build with Cursor, Review with CC")

### Parameters & Schema
- [ ] What parameters does `feature-autonomous-start` currently accept, and which of those should be captured in a workflow?
- [ ] What's the minimal workflow schema that covers current autonomous parameters?
- [ ] How does the schema extend to multi-stage pipelines (e.g., implement -> review -> counter-review -> close)?
- [ ] Should there be built-in/default workflows shipped with Aigon (e.g., "Solo CC", "Arena CC+GG", "Build CU, Review CC")?

### Storage & Backup
- [ ] Where should workflows be stored? Options to evaluate:
  - `.aigon/workflows.json` or `.aigon/workflows/` directory (per-project, committed to git — automatically backed up)
  - `~/.aigon/workflows/` (global, user-level — shared across projects, but not version-controlled by default)
  - Both: global defaults + per-project overrides
- [ ] Should workflow definitions live in version-controlled files so they're inherently backed up with the repo?
- [ ] For global workflows (not tied to a project), what's the backup story?
  - Private GitHub repo (e.g., dotfiles-style `~/.aigon/` repo)
  - Sync via `aigon config export/import`
  - Document the `~/.aigon/` path so users can add it to their own backup strategy
- [ ] Can workflows be shared across a team by committing them to the project repo?

### Runtime & UI
- [ ] How should workflows be selected at runtime? (CLI flag `--workflow cursor-review`, interactive picker, dashboard dropdown)
- [ ] How do workflows interact with the dashboard — can users select a workflow when starting a feature from the UI?
- [ ] Should workflows be versioned or just overwritten?
- [ ] What's the simplest v1 that adds real value without building a full pipeline engine?

## Scope

**In scope:**
- Naming validation (workflow vs template vs other terms)
- Workflow schema design for current autonomous parameters
- Storage location, format, and backup strategy
- CLI and dashboard integration points
- Extension path toward multi-stage pipelines

**Out of scope:**
- Actually building multi-stage pipeline execution (that's a separate feature)
- Workflow sharing/marketplace
- Workflow inheritance or composition
- External system integrations (PR creation, deployment) — noted as future direction only

## Inspiration

- The user's current workflow: "implement with Cursor, review with Claude Code, through to close" — repeated manually each time
- CI/CD pipeline definitions (GitHub Actions YAML, Buildkite) as prior art for defining multi-stage workflows declaratively
- Docker Compose profiles as an example of named configuration presets
- Makefile targets / npm scripts as the simplest form of "named command bundles"

## Recommendation

Build "Aigon Workflows" as a thin layer over `feature-autonomous-start` parameters. All three agents (CC, GG, CX) converge on the same core design: v1 is saved parameter bundles with CLI CRUD, a `--workflow <slug>` flag, built-in starters, and project+global storage. No pipeline DSL, no stages, no conditionals in v1.

Key decisions from synthesis:
- **Naming**: "workflow" (2/3 agents preferred it; matches industry conventions). Tighten internal docs to distinguish "workflow engine" from "workflow definitions".
- **Storage**: `.aigon/workflow-definitions/<slug>.json` (project) + `~/.aigon/workflow-definitions/<slug>.json` (global) — avoids collision with `.aigon/workflows/` engine state.
- **Schema**: flat JSON mapping to autonomous-start params. v2 adds `stages` array; v1 format stays valid forever.
- **Extension path**: ordered stage list (Buildkite model), not DAG (GitHub Actions model).

## Output

### Selected Features

| Feature Name | Description | Priority |
|--------------|-------------|----------|
| workflow-definitions | CLI CRUD, `--workflow` flag, project+global storage, built-in starters | high |
| workflow-dashboard-picker | Dashboard dropdown in Autonomous Start modal with pre-fill and save-as | medium |
| workflow-stages-v2 | v2 schema: ordered `stages` array for multi-step pipelines | low |

### Feature Dependencies
- workflow-dashboard-picker depends on workflow-definitions
- workflow-stages-v2 depends on workflow-definitions

### Not Selected
- workflow-export-import: Low priority, can be added later without its own spec
- workflow-interactive-picker: Nice-to-have CLI UX, not worth a separate feature
