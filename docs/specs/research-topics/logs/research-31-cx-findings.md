# Research Findings: workflow templates

**Agent:** Codex (cx)
**Research ID:** 31
**Date:** 2026-04-17

---

## Key Findings

### 1. `feature-autonomous-start` already has a small, template-friendly parameter surface

The actual user-facing autonomous start contract is:

- `aigon feature-autonomous-start <feature-id> <agents...>`
- Optional `--stop-after=implement|eval|review|close`
- Optional `--eval-agent=<agent>`
- Optional `--review-agent=<agent>`
- `status <feature-id>` for inspection

The implementation enforces a few important rules:

- At least one implementation agent is required.
- `review` is solo-only.
- `--review-agent` is ignored in Fleet mode.
- `--eval-agent` is ignored in solo mode.
- In solo mode, `--stop-after=eval` is normalized to `close`.
- Internal loop args such as `__run-loop`, `--agents`, `--session-name`, and `--poll-seconds` are conductor internals and should not be part of the template model.

Evidence:

- Actual CLI parsing and validation: [lib/commands/feature.js](../../../../lib/commands/feature.js) lines 3126-3275
- Dashboard API already uses the same shape: `agents`, `stopAfter`, `evalAgent`, `reviewAgent`: [lib/dashboard-server.js](../../../../lib/dashboard-server.js) lines 1678-1769
- Backlog action already exists in the workflow rules: [lib/feature-workflow-rules.js](../../../../lib/feature-workflow-rules.js) lines 327-328
- Dashboard modal already exposes Implementation agents, Evaluator, Reviewer, and Stop after: [templates/dashboard/index.html](../../../../templates/dashboard/index.html) lines 265-289

Important mismatch I found:

- The actual CLI supports `--review-agent` and `--stop-after=review`, but the help/arg-hint surfaces are stale and omit them. See [lib/templates.js](../../../../lib/templates.js) line 312 and [templates/help.txt](../../../../templates/help.txt) line 80 versus [lib/commands/feature.js](../../../../lib/commands/feature.js) lines 3128-3147.

Recommendation: treat the runtime truth as the implementation and dashboard payload shape, not the current help text.

### 2. Storage options: `.aigon/config.json` is the best v1 home

I evaluated three realistic storage approaches:

#### Option A: Store templates in project config (`.aigon/config.json`)

Pros:

- Aigon already has first-class project config loading/saving at `.aigon/config.json`.
- The repo already commits project config changes when desired, which is useful for team-shared workflow defaults.
- The dashboard already reads project config and uses it as the repo-local source of truth.

Cons:

- Mixed concerns if templates grow large.

Assessment: best default for project-scoped templates.

#### Option B: Store templates in a dedicated file such as `.aigon/workflow-templates.json` or YAML

Pros:

- Cleaner separation if template volume grows.
- Easier to hand-edit if multi-stage workflows eventually become larger documents.

Cons:

- New file format, new loader, new merge logic, new dashboard plumbing.
- Aigon already has config infrastructure and precedence rules; this duplicates them for little immediate gain.

Assessment: overbuilt for v1.

#### Option C: Store templates in global config (`~/.aigon/config.json`)

Pros:

- Good for personal defaults that span many repos.
- Aigon already supports global config and project-over-global precedence.

Cons:

- Bad default for team conventions because templates become invisible to collaborators unless exported separately.

Assessment: useful as an override layer, but not the primary location.

Recommended storage model:

- Project templates in `.aigon/config.json`
- Optional personal templates/defaults in `~/.aigon/config.json`
- Resolution order: built-in templates < global templates < project templates

This matches both Aigon’s current config layering and common CLI precedent:

- Aigon project/global config paths and load/save APIs: [lib/config.js](../../../../lib/config.js) lines 206-214, 309-360, 420-447
- Aigon already merges global then project settings for agent config: [lib/config.js](../../../../lib/config.js) lines 773-828
- Git itself uses layered config scopes, with later/local values taking precedence: https://git-scm.com/docs/git-config/2.48.1.html#_files

### 3. Minimal template schema should mirror the existing dashboard payload

The simplest schema that covers current autonomous parameters is:

```json
{
  "workflowTemplates": {
    "build-cu-review-cc": {
      "kind": "feature-autonomous-v1",
      "description": "Implement with Cursor, review with Claude Code, then close",
      "agents": ["cu"],
      "stopAfter": "close",
      "reviewAgent": "cc"
    },
    "arena-cc-gg-eval-cc": {
      "kind": "feature-autonomous-v1",
      "description": "Parallel implementation with Claude and Gemini, evaluated by Claude",
      "agents": ["cc", "gg"],
      "stopAfter": "eval",
      "evalAgent": "cc"
    }
  }
}
```

Why this shape:

- It matches the existing dashboard/API payload (`agents`, `stopAfter`, `evalAgent`, `reviewAgent`) so the server can resolve a template into the exact command it already builds.
- `kind` future-proofs the object without forcing a full stage/pipeline model into v1.
- No `featureId` belongs in the template; that stays runtime input.
- No internal loop/session fields belong in the schema.

Validation rules should stay aligned with current runtime behavior:

- `agents.length >= 1`
- `stopAfter ∈ {implement, eval, review, close}`
- If `agents.length > 1`, allow `evalAgent`, ignore or reject `reviewAgent`
- If `agents.length === 1`, allow `reviewAgent`, ignore `evalAgent`
- If `stopAfter === review`, require exactly one implementation agent plus `reviewAgent`

Alternative schemas considered:

- Full `stages: []` pipeline schema now: more future-proof, but too much design surface for v1.
- Separate keys like `implementationAgents` instead of `agents`: clearer in isolation, but adds translation friction versus the existing dashboard API.

Recommendation: use the runtime payload shape plus a small `kind` marker.

### 4. Runtime selection should start with `--template <name>` and a dashboard dropdown

I evaluated three runtime selection paths:

#### CLI flag

Recommended v1:

```bash
aigon feature-autonomous-start 42 --template build-cu-review-cc
```

Pros:

- Scriptable
- Discoverable
- Mirrors Docker Compose’s named-profile activation model (`--profile`): https://docs.docker.com/reference/cli/docker/compose/

Cons:

- Requires one more lookup step if the user forgets template names

Assessment: the best primary interface.

#### Interactive picker

Pros:

- Friendly for occasional users

Cons:

- Harder to automate
- Adds a new prompt flow to a command that currently stays non-interactive

Assessment: optional later, not needed for v1.

#### Dashboard dropdown

Pros:

- The dashboard already has a Start Autonomously modal with the relevant controls.
- Prior art exists for UI template assignment; Buildkite supports assigning templates from a dropdown and via API.

Cons:

- Requires some additional UI state and “custom vs template” logic.

Assessment: should ship in v1 together with CLI, because the modal already exists and the payload shape is stable.

Recommended UX:

- CLI: `--template <name>`
- Dashboard: template dropdown with `Custom` fallback
- When a template is chosen in the dashboard, populate the existing fields from the template

Server behavior:

- Accept either explicit fields or `template`
- Resolve `template` server-side into `agents`, `stopAfter`, `evalAgent`, `reviewAgent`
- Reject ambiguous mixed input in v1 (for example, `--template` plus manual overrides) to keep behavior obvious

Buildkite prior art for UI/API template assignment: https://buildkite.com/docs/pipelines/governance/templates

### 5. Built-in templates are worth shipping, but keep the set small

Yes, Aigon should ship a few built-in templates. They add immediate value because the problem statement is repetitive, common flows rather than arbitrary pipelines.

Suggested built-ins:

- `solo-cc-close`
- `solo-cx-close`
- `build-cu-review-cc`
- `arena-cc-gg-eval-cc`

Guidelines:

- Ship 3-5 templates, not a gallery of permutations
- Built-ins should be read-only defaults in code
- User/global/project templates can override by name

GitHub’s workflow templates and reusable workflows are useful prior art for centrally provided defaults, but they also show that visibility/sharing rules add complexity quickly. That argues for local/global built-ins first, org sharing later: https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations

### 6. Multi-stage evolution should be planned for, but not implemented in v1

The most important design choice is to avoid locking v1 into a dead-end shape while still resisting the temptation to build a pipeline engine now.

Best path:

- v1 templates are aliases for the existing linear conductor configuration
- Add `kind: feature-autonomous-v1` now
- Reserve a future `kind: feature-pipeline-v2` or `stages: []` design for later

That gives a clean extension path such as:

```json
{
  "workflowTemplates": {
    "build-review-counterreview": {
      "kind": "feature-pipeline-v2",
      "stages": [
        { "type": "implement", "agents": ["cu"] },
        { "type": "review", "agent": "cc" },
        { "type": "review-check", "agent": "cu" },
        { "type": "close" }
      ]
    }
  }
}
```

But none of that should block v1.

External prior art supports this phased approach:

- GitHub reusable workflows are powerful, but they also come with limits, context rules, and permission constraints; reusable abstractions grow complexity quickly: https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations
- Buildkite supports both centrally assigned templates and dynamically generated pipelines, which is effectively the “simple preset first, richer graph later” progression: https://buildkite.com/docs/pipelines/governance/templates and https://buildkite.com/docs/pipelines/configure/dynamic-pipelines

### 7. Simplest v1 that adds real value

The smallest useful feature is:

1. Add `--template <name>` to `feature-autonomous-start`
2. Add `workflowTemplates` loading from project/global config
3. Resolve the template to the existing runtime arguments
4. Add a template dropdown to the dashboard autonomous modal
5. Ship a few built-in templates

Explicitly out of scope for v1:

- Arbitrary stage graphs
- Template inheritance/composition
- Sharing/marketplace/distribution
- Per-template semantic version history

### 8. Versioning: schema version yes, per-template revisioning no

For v1, templates should be overwritten, not versioned individually.

Why:

- Project templates already live in git when stored in `.aigon/config.json`
- Global config already has backup behavior
- Per-template version tracking introduces lifecycle/UI complexity before there is any template registry or sharing system

What to version:

- The schema, via `kind` or `schemaVersion`

What not to version yet:

- User-edited template revisions like `v3`, `v4`, etc.

This is also consistent with the scope: Aigon needs named presets, not a template package manager.

## Sources

- Local implementation:
  - [lib/commands/feature.js](../../../../lib/commands/feature.js)
  - [lib/dashboard-server.js](../../../../lib/dashboard-server.js)
  - [lib/config.js](../../../../lib/config.js)
  - [lib/feature-workflow-rules.js](../../../../lib/feature-workflow-rules.js)
  - [lib/templates.js](../../../../lib/templates.js)
  - [templates/dashboard/index.html](../../../../templates/dashboard/index.html)
  - [templates/help.txt](../../../../templates/help.txt)
- Git config scopes and precedence: https://git-scm.com/docs/git-config/2.48.1.html
- GitHub reusable workflows and workflow templates: https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations
- Docker Compose named profiles: https://docs.docker.com/reference/cli/docker/compose/
- Buildkite pipeline templates: https://buildkite.com/docs/pipelines/governance/templates
- Buildkite dynamic pipelines: https://buildkite.com/docs/pipelines/configure/dynamic-pipelines

## Recommendation

Implement workflow templates as a thin named-preset layer over the existing `feature-autonomous-start` API, not as a new workflow engine.

Concrete recommendation:

- Store templates in `.aigon/config.json` under `workflowTemplates`
- Support optional global defaults in `~/.aigon/config.json`
- Use a minimal schema with `kind`, `agents`, `stopAfter`, `evalAgent`, and `reviewAgent`
- Add CLI support for `--template <name>`
- Add a dashboard dropdown that fills the existing autonomous modal controls
- Ship a very small built-in template set
- Do not build `stages: []`, inheritance, or per-template version history in v1

This delivers immediate value for repeated workflows, reuses the current dashboard/API/CLI contract almost directly, and leaves a clean upgrade path to richer multi-stage orchestration later.

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
| workflow-template-schema | Add a minimal `workflowTemplates` config schema for autonomous feature presets with validation rules aligned to current `feature-autonomous-start` behavior. | high | none |
| feature-autonomous-template-flag | Add `--template <name>` resolution to `aigon feature-autonomous-start` and reject ambiguous mixed template/manual inputs in v1. | high | workflow-template-schema |
| dashboard-autonomous-template-picker | Add a template dropdown to the dashboard autonomous modal that resolves or pre-fills the existing agent/evaluator/reviewer/stop-after fields. | high | workflow-template-schema |
| built-in-workflow-templates | Ship a small curated set of built-in autonomous workflow templates such as solo, review, and arena presets. | medium | workflow-template-schema |
| workflow-template-future-pipeline-shape | Reserve a future-compatible schema path for multi-stage workflows without implementing a pipeline engine in v1. | low | workflow-template-schema |
