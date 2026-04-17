# Feature: workflow-definitions

## Summary
Saved workflow definitions: CLI CRUD (`aigon workflow create/list/show/delete`), `--workflow <slug>` flag on `feature-autonomous-start` and `feature-start`, project + global storage (`.aigon/workflow-definitions/` and `~/.aigon/workflow-definitions/`), and built-in starter workflows (solo, solo-reviewed, arena, fleet). Eliminates re-entering agent combinations, review strategy, and stop-after phase each time a user starts autonomous features.

## User Stories
- [ ] As a user with an established pattern (e.g., "implement with CU, review with CC, close"), I can save it as a named workflow and invoke it with `--workflow <slug>` instead of re-entering all flags
- [ ] As a team member, I can commit project workflows to git so the whole team shares the same configurations
- [ ] As a new user, I can run built-in workflows (solo, arena, fleet) without creating my own first

## Acceptance Criteria
- [ ] `aigon workflow create <slug>` creates a workflow definition (interactive or flag-based)
- [ ] `aigon workflow list` shows all available workflows (built-in + global + project) with provenance
- [ ] `aigon workflow show <slug>` displays the full definition
- [ ] `aigon workflow delete <slug>` removes a user-created workflow
- [ ] `aigon feature-autonomous-start <id> --workflow <slug>` resolves saved params and launches
- [ ] CLI flags override workflow values when both are provided
- [ ] Project workflows (`.aigon/workflow-definitions/<slug>.json`) override global (`~/.aigon/workflow-definitions/<slug>.json`) with same slug
- [ ] Built-in workflows (solo, solo-reviewed, arena, fleet) are always available and read-only
- [ ] Schema validates solo/fleet constraints (e.g., fleet cannot have reviewAgent, solo cannot have evalAgent)

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- v1 schema: flat JSON mapping to `feature-autonomous-start` params (`agents`, `evalAgent`, `reviewAgent`, `stopAfter`) plus `slug`, `label`, `description`
- Storage: one JSON file per workflow in `.aigon/workflow-definitions/` (project) and `~/.aigon/workflow-definitions/` (global)
- Resolution order: built-in < global < project (project wins on slug collision)
- Built-ins defined in code, not files — always available, overridable by user workflow with same slug
- No stages, conditionals, or inheritance — v1 is "npm scripts" simplicity

## Dependencies
- none

## Out of Scope
- Multi-stage pipeline execution (see workflow-stages-v2)
- Dashboard integration (see workflow-dashboard-picker)
- Workflow versioning / revision history
- Inheritance or composition between workflows
- Export/import commands
- Interactive CLI picker (fzf-style)

## Open Questions
- Use "workflow" (CX/GG recommendation — matches industry convention) or "playbook" (CC recommendation — avoids workflow-core collision)?

## Related
- Research: #29 workflow-templates
