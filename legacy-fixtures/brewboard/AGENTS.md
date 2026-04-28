# Project Instructions

## Testing

This is a test/demo repo — do NOT write tests. No unit tests, no integration tests, no Playwright tests. There is no test infrastructure.

## Build & Run

Use `aigon dev-server start` for port-managed startup.

## Dependencies

`npm install` in the project root.

## Implementation Guidelines

This is a simple seed repo used for testing the Aigon workflow. Features are intentionally trivial. Follow these rules:

- **No tests** — do not write unit, integration, or e2e tests
- **No plan mode** — features here are always simple; skip plan mode and implement directly
- **Minimal logs** — implementation logs should be one line ("Implemented X") not a narrative
- **No doc updates** — do not update CLAUDE.md or architecture docs for seed repo features
- **One commit** — combine code and log into a single commit, not two separate ones

<!-- AIGON_START -->
## Aigon

This project uses the Aigon development workflow.

- Agent-specific notes: `docs/agents/*.md`
- Architecture overview: `docs/architecture.md`
- Development workflow: `docs/development_workflow.md`
<!-- AIGON_END -->
