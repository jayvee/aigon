# Aigon Architecture

## Purpose

This document gives agents and contributors a fast map of the Aigon codebase. It focuses on where workflow state lives, how the CLI is structured, and where new code should go.

## Repository Layout

- `aigon-cli.js`: thin CLI entrypoint. It parses argv, resolves aliases, dispatches commands, and handles top-level async errors.
- `lib/`: shared implementation modules used by the CLI.
- `lib/commands/`: command-family handlers. This is where most command behavior should live.
- `templates/`: prompt, docs, agent, and spec templates used by install and scaffolding commands.
- `docs/specs/`: workflow state for features, research, feedback, logs, and evaluations.
- `docs/agents/`: agent-specific operational notes installed into projects.

## CLI Structure

The CLI is intentionally split into layers:

1. `aigon-cli.js`
   Responsibility: command dispatch only.
2. `lib/commands/*.js`
   Responsibility: user-facing command handlers grouped by domain.
3. `lib/*.js`
   Responsibility: reusable logic and shared data.

Current command families:

- `lib/commands/feature.js`
- `lib/commands/research.js`
- `lib/commands/feedback.js`
- `lib/commands/setup.js`
- `lib/commands/misc.js`

Current shared modules:

- `lib/constants.js`: registries, path constants, command metadata, agent metadata
- `lib/config.js`: global and project config, profiles, model/config resolution
- `lib/devserver.js`: port allocation, proxy registration, dev-server helpers
- `lib/dashboard.js`: dashboard status aggregation, HTML generation, radar helpers
- `lib/worktree.js`: worktree discovery, terminal launching, tmux helpers
- `lib/hooks.js`: hook parsing and execution
- `lib/templates.js`: template loading, placeholder expansion, agent-install helpers
- `lib/board.js`: board rendering and board action helpers
- `lib/validation.js`: Ralph/autonomous validation helpers
- `lib/feedback.js`: feedback parsing, normalization, similarity, triage helpers
- `lib/utils.js`: shared implementation surface used by the domain modules

## Workflow State

The Aigon workflow is state-as-location. Task state is represented by file location under `docs/specs/`.

- `docs/specs/features/01-inbox` to `06-paused`
- `docs/specs/research-topics/01-inbox` to `05-paused`
- `docs/specs/feedback/01-inbox` to `06-duplicate`
- `docs/specs/features/logs/`: implementation logs
- `docs/specs/features/evaluations/`: evaluation outputs

Core rule: use the CLI to move specs between states. Do not rename or move spec files manually.

## Where To Make Changes

- Add or change a CLI command:
  edit the relevant file in `lib/commands/`.
- Add shared behavior used by multiple commands:
  prefer the most specific `lib/*.js` module that owns the domain.
- Add shared constants, registry data, or command metadata:
  update `lib/constants.js`.
- Add agent-install content or generated docs:
  update files under `templates/`.
- Change workflow file conventions:
  update the owning command module and any affected templates/docs together.

## Design Rules

- Keep `aigon-cli.js` free of business logic.
- Prefer explicit CommonJS exports.
- Keep command handlers grouped by domain, not one file per command.
- Avoid circular dependencies between `lib/*.js` modules.
- Treat `templates/` as source-of-truth for generated agent docs and prompts.

## Reading Order For New Agents

When orienting to the repo, read in this order:

1. `AGENTS.md`
2. `docs/architecture.md`
3. `docs/development_workflow.md`
4. the active spec under `docs/specs/...`
5. the relevant command module under `lib/commands/`
