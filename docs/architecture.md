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

> **Note (as of feature 69):** All `lib/*.js` domain modules below are currently thin re-export facades — they re-export functions from `lib/utils.js` where the actual logic lives. Feature 68 (complete-cli-modularization) will move logic from `lib/utils.js` into these modules. Until then, if you need to find or edit the real implementation, look in `lib/utils.js` at the line ranges noted below.

- `lib/constants.js`: registries, path constants, command metadata, agent metadata
  _(logic in `lib/utils.js` ~223–575 config/registry constants)_
- `lib/config.js`: global and project config, profiles, model/config resolution
  _(logic in `lib/utils.js` ~223–575 `loadGlobalConfig`, `loadProjectConfig`, `getActiveProfile`, `getEffectiveConfig`)_
- `lib/devserver.js`: port allocation, proxy registration, dev-server helpers
  _(logic in `lib/utils.js` ~576–1111 `allocatePort`, `registerDevServer`, `spawnDevServer`, `waitForHealthy`)_
- `lib/dashboard.js`: dashboard status aggregation, HTML generation, radar helpers
  _(logic in `lib/utils.js` ~1187–2230 `collectDashboardStatusData`, `buildDashboardHtml`, radar daemon helpers)_
- `lib/worktree.js`: worktree discovery, terminal launching, tmux helpers
  _(logic in `lib/utils.js` ~5359–5474 `setupWorktreeEnvironment`, `ensureAgentSessions`)_
- `lib/hooks.js`: hook parsing and execution
  _(logic in `lib/utils.js` — hook helpers used in command pre/post hook calls)_
- `lib/templates.js`: template loading, placeholder expansion, agent-install helpers
  _(logic in `lib/utils.js` ~6272–6530 `readTemplate`, `processTemplate`, `readGenericTemplate`, `formatCommandOutput`)_
- `lib/board.js`: board rendering and board action helpers
  _(logic in `lib/utils.js` ~6531–7016 `collectBoardItems`, `displayBoardKanbanView`, `displayBoardListView`)_
- `lib/validation.js`: Ralph/autonomous validation helpers
  _(logic in `lib/utils.js` ~7017–8205 `runRalphCommand`, `runSmartValidation`, `parseAcceptanceCriteria`)_
- `lib/feedback.js`: feedback parsing, normalization, similarity, triage helpers
  _(logic in `lib/utils.js` ~4673–5202 `parseFrontMatter`, `normalizeFeedbackMetadata`, `findDuplicateFeedbackCandidates`, `buildFeedbackTriageRecommendation`)_
- `lib/utils.js`: the actual shared implementation surface — contains all domain logic until feature 68 lands
  _(~8530 lines; see NAVIGATION index at top of file)_

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

## Naming Conventions

Aigon uses consistent naming across worktrees, branches, and tmux sessions:

| Layer          | Pattern                              | Example                                    |
|----------------|--------------------------------------|--------------------------------------------|
| Branch         | `feature-{num}-{agent}-{desc}`       | `feature-07-cc-restore-on-scan`            |
| Worktree dir   | `feature-{num}-{agent}-{desc}`       | `feature-07-cc-restore-on-scan`            |
| Tmux session   | `{repo}-f{num}-{agent}-{desc}`       | `whos-buy-is-it-f07-cc-restore-on-scan`   |
| Window title   | (same as tmux session)               | `whos-buy-is-it-f07-cc-restore-on-scan`   |

Research follows the same pattern with `r` instead of `f`:

| Layer          | Pattern                              | Example                                    |
|----------------|--------------------------------------|--------------------------------------------|
| Tmux session   | `{repo}-r{num}-{agent}`              | `aigon-r05-cc`                             |

Components:
- `{repo}` — repository directory name (e.g., `aigon`, `farline-ai`, `whos-buy-is-it`)
- `{num}` — zero-padded feature/research ID (e.g., `07`, `140`)
- `{agent}` — agent short code (`cc`, `gg`, `cx`, `cu`)
- `{desc}` — kebab-case feature description from the spec filename

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
