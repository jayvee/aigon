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

## Implementation Notes

### Multi-agent stages (from retired feature-multiple-reviewers-in-autonomous-mode)
The workflow schema must support multiple agents per stage — e.g. a review stage with `"agents": ["cc", "gg"]`. This subsumes the previously proposed `--review-agent=cc --review-agent=gg` CLI flag extension. The AutoConductor needs to spawn all agents for a stage and treat the stage as complete only when all have finished. This is a general workflow capability, not a reviewer-specific feature. The retired spec also noted:
- Cap at 2 reviewers initially (can relax later if workflows support arbitrary counts)
- Parallel execution preferred over sequential (lower latency, fully independent)
- `feature-review-check` needs to surface multiple review outputs, attributed by agent
- Status reporting should show each agent's completion state independently

## Inspiration

- The user's current workflow: "implement with Cursor, review with Claude Code, through to close" — repeated manually each time
- CI/CD pipeline definitions (GitHub Actions YAML, Buildkite) as prior art for defining multi-stage workflows declaratively
- Docker Compose profiles as an example of named configuration presets
- Makefile targets / npm scripts as the simplest form of "named command bundles"
