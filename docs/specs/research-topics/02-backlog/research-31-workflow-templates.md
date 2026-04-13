# Research: Workflow Templates

## Context

When starting a feature autonomously, users must specify the agent combination, review strategy, and stop-after phase each time. For users with established patterns (e.g., "implement with Cursor, review with Claude Code, close automatically"), re-entering these parameters is tedious and error-prone.

Workflow templates would let users define named, reusable configurations that feed directly into `feature-autonomous-start`. Today the workflow is fairly linear (one implementation round, one optional review, then close), but as multi-round workflows become possible (implementation, review, counter-review, re-implementation), templates will become the primary way users express complex orchestration without remembering flag combinations.

The initial scope should be simple: let users select from pre-defined or user-created templates that map to current `feature-autonomous-start` parameters. The research should also consider how the template model extends to richer multi-stage workflows in the future.

## Questions to Answer

- [ ] What parameters does `feature-autonomous-start` currently accept, and which of those should be captured in a template?
- [ ] Where should templates be stored? (`.aigon/config.json`, dedicated file, per-project vs global)
- [ ] What's the minimal template schema that covers current autonomous parameters?
- [ ] How should templates be selected at runtime? (CLI flag like `--template "build-cursor-review-cc"`, interactive picker, dashboard dropdown)
- [ ] Should there be built-in/default templates shipped with Aigon (e.g., "Solo CC", "Arena CC+GG", "Build CU, Review CC")?
- [ ] How does the template model extend to multi-stage workflows (e.g., implement -> review -> counter-review -> close)?
- [ ] What's the simplest v1 that adds real value without building a full pipeline engine?
- [ ] How do templates interact with the dashboard — can users select a template when starting a feature from the UI?
- [ ] Should templates be versioned or just overwritten?

## Scope

**In scope:**
- Template schema design for current autonomous parameters
- Storage location and format
- CLI and dashboard integration points
- Extension path toward multi-stage pipelines

**Out of scope:**
- Actually building multi-stage pipeline execution (that's a separate feature)
- Template sharing/marketplace
- Template inheritance or composition

## Inspiration

- The user's current workflow: "implement with Cursor, review with Claude Code, through to close" — repeated manually each time
- CI/CD pipeline definitions (GitHub Actions YAML, Buildkite) as prior art for defining multi-stage workflows declaratively
- Docker Compose profiles as an example of named configuration presets
