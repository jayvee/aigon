> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.

# Feature: autonomous-workflow-definitions

## Summary
Named, reusable workflow definitions for `feature-autonomous-start` only. Users save an autonomous orchestration plan as a named workflow and invoke it with `--workflow <slug>` instead of re-entering implementation agents, review/eval agent, and stop-after behavior every time.

This is explicitly **not** a `feature-start` feature. `feature-start` remains a setup command that creates the branch/worktrees and stops. Workflow definitions apply only to the autonomous conductor path.

This is an **Aigon Pro-owned** feature. Autonomous Start is a Pro capability today, so the canonical feature spec lives in `aigon-pro`. If OSS aigon changes are needed to support it, those changes should be implemented as cross-repo Pro support work and the aigon commit should include:

```text
Cross-repo: aigon-pro feature N
```

This spec replaces the reverted features 266, 267, and 268 with a narrower scope and a cleaner definition: one stages-based schema, one code path, one command surface.

## Cross-repo touch
- aigon: lib/workflow-definitions.js
- aigon: lib/commands/misc.js
- aigon: lib/commands/feature.js
- aigon: lib/dashboard-server.js
- aigon: templates/dashboard/index.html
- aigon: templates/dashboard/js/actions.js
- aigon: templates/dashboard/js/api.js
- aigon: templates/generic/commands/feature-autonomous-start.md
- aigon: templates/help.txt
- aigon: docs/architecture.md
- aigon: AGENTS.md
- aigon: CLAUDE.md

## User Stories
- [ ] As a user with a preferred autonomous pattern, I can save it as a named workflow and invoke it with `--workflow <slug>`
- [ ] As a user, I can run built-in autonomous workflows without creating my own first
- [ ] As a team member, I can commit project workflows to git so the whole team shares the same autonomous configurations
- [ ] As a user starting a feature from the Autonomous Start modal, I can select a saved workflow from a dropdown to pre-fill the modal
- [ ] As a user, I only need to learn one workflow schema: the autonomous stages format

## Acceptance Criteria

### Scope
- [ ] Workflow definitions are supported only by `aigon feature-autonomous-start`
- [ ] `aigon feature-start` does not accept `--workflow`
- [ ] The spec and docs consistently describe workflows as autonomous orchestration templates, not general feature lifecycle state
- [ ] The canonical implementation spec is created and tracked in `aigon-pro`

### Schema
- [ ] Every workflow definition uses a `stages` array
- [ ] There is no flat schema, no version discriminator, and no dual-format normalization
- [ ] Built-in workflows use the same stages format
- [ ] CLI flags are syntactic sugar that build a stages array internally before execution

### CLI
- [ ] `aigon workflow create <slug>` creates an autonomous workflow definition
- [ ] `aigon workflow list` shows all available workflows with provenance
- [ ] `aigon workflow show <slug>` displays the full stage definition
- [ ] `aigon workflow delete <slug>` removes a user-created workflow
- [ ] `aigon feature-autonomous-start <id> --workflow <slug>` resolves saved params and launches
- [ ] CLI flags override workflow values when both are provided

### Storage & Precedence
- [ ] Project workflows stored in `.aigon/workflow-definitions/<slug>.json`
- [ ] Global workflows stored in `~/.aigon/workflow-definitions/<slug>.json`
- [ ] Project overrides global overrides built-in
- [ ] Built-in workflows are always available and read-only

### Built-ins
- [ ] `solo`: implement(cc) -> close
- [ ] `solo-reviewed`: implement(cc) -> review(gg) -> counter-review(cc) -> close
- [ ] `arena`: implement(cc,gg) -> eval(cc) -> close
- [ ] `fleet`: implement(cc,gg,cx) -> eval(cc) -> close
- [ ] No retired agents are referenced

### Dashboard
- [ ] Workflow dropdown appears only in the Autonomous Start modal
- [ ] Selecting a workflow populates agent checkboxes, eval/review dropdowns, and stop-after
- [ ] User can override any pre-filled value before submitting
- [ ] "Save as workflow" saves the current modal state as a new project workflow
- [ ] `GET /api/workflows` returns merged workflow definitions for the autonomous modal

### Models
- [ ] Each stage supports an optional `models` map: `{ "agentId": "modelId" }`
- [ ] Agents without a `models` entry use their existing resolved default model
- [ ] Built-in workflows do not specify models
- [ ] Model overrides flow through the existing agent launch/config path rather than bypassing it

### Params
- [ ] Each stage supports an optional `params` map: `{ "agentId": { "key": "value" } }`
- [ ] Parameters are limited to supported launch/config inputs for that agent
- [ ] Unsupported parameters are rejected or ignored by explicit rule, not by undocumented passthrough behavior
- [ ] Built-in workflows do not specify params

### Validation Rules
- [ ] Stages must begin with `implement`
- [ ] `close` must be the final stage if present
- [ ] Valid stage types: `implement`, `review`, `counter-review`, `eval`, `close`
- [ ] `review` and `eval` stages require exactly one agent
- [ ] `review` and `counter-review` require exactly one implementing agent
- [ ] `eval` requires at least two implementing agents
- [ ] Review-based and eval-based workflows cannot be combined

## Validation
```bash
cd ~/src/aigon
node --check aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
```

## Technical Approach

### Schema format
```json
{
  "slug": "solo-reviewed",
  "label": "Solo Reviewed",
  "description": "Implement with CC, review with GG, close automatically",
  "stages": [
    { "type": "implement", "agents": ["cc"], "models": { "cc": "sonnet" } },
    { "type": "review", "agents": ["gg"] },
    { "type": "counter-review", "agents": ["cc"] },
    { "type": "close" }
  ]
}
```

### Command boundary
The workflow definition resolves to the existing `feature-autonomous-start` inputs:
- implementation agents
- eval agent or review agent as appropriate
- stop-after behavior
- optional per-stage model overrides
- optional per-stage supported launch params

`feature-start` stays unchanged. It should not parse, validate, or execute workflow definitions.

### Launch/config integration
Per-stage `models` and `params` must integrate with the existing launch path in `lib/worktree.js`, `lib/config.js`, and agent capability metadata. The implementation should not invent a second launch mechanism for autonomous runs.

### Repo ownership
Primary feature ownership belongs in `aigon-pro` because autonomous orchestration is Pro-only. OSS aigon may still need the cross-repo support files listed above.

### Prior implementation (reverted)
The reverted features still contain reusable code for:
- slug normalization
- project/global file I/O
- precedence resolution
- dashboard dropdown UX
- `/api/workflows`
- stage ordering validation
- autonomous stage execution wiring

Reuse those pieces selectively, but do not restore:
- dual schema support
- `version` handling
- legacy flat-field parsing
- `feature-start --workflow`

## Dependencies
- Aigon OSS cross-repo support
- Feature 233 (`cross-repo-feature-support`) or an equivalent paired-worktree flow. Without that, `aigon-pro` worktrees can own this spec but cannot execute the listed `aigon` code changes from the same feature workspace.

## Out of Scope
- `feature-start` presets or saved setup profiles
- Workflow support for non-autonomous feature commands
- Workflow inheritance or composition
- Conditional/branching pipelines
- Marketplace/import-export behavior

## Open Questions
- How much of the workflow-definition CRUD/UI should live in OSS aigon versus `@aigon/pro`?
- Should agent `params` be restricted to an allowlist per agent/task instead of free-form maps?
- Should this feature stay blocked on feature 702, or should the team explicitly allow manual paired-branch execution for cross-repo Pro features until paired worktrees ship?

## Related
- Research: #31 workflow-templates
- Reverted: features 266, 267, 268
- Reverted: feature 270
