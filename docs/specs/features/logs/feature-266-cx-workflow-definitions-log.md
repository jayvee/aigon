# Implementation Log: Feature 266 - workflow-definitions
Agent: cx

## Plan
- Add reusable workflow-definition storage and validation for built-in, global, and project scopes.
- Expose a top-level `aigon workflow` subcommand family for create/list/show/delete.
- Wire `--workflow <slug>` into `feature-start` and `feature-autonomous-start` with explicit CLI overrides winning.
- Add integration coverage and update architecture docs/templates to match the new command surface.

## Progress
- Implemented `lib/workflow-definitions.js` with:
  - built-in workflows (`solo`, `solo-reviewed`, `arena`, `fleet`)
  - project/global file storage under `.aigon/workflow-definitions/` and `~/.aigon/workflow-definitions/`
  - validation for solo/fleet schema constraints
  - effective resolution order: built-in < global < project
  - launch-time merge helper so explicit CLI values override saved workflow values
- Added `aigon workflow create|list|show|delete` in `lib/commands/misc.js`.
- Added `--workflow <slug>` support to `feature-start` and `feature-autonomous-start`.
- Updated command metadata/templates/help text so installed agent commands match the new CLI behavior.
- Added `tests/integration/workflow-definitions.test.js` and wired it into `npm test`.
- Restarted the AIGON server after backend edits with `aigon server restart`.

## Decisions
- Kept the standalone `workflow` command in `lib/commands/misc.js` because `aigon-cli.js` dispatches on the first argv token, so `aigon workflow create` must be handled as a subcommand family rather than as `workflow-create`.
- Moved the storage/validation logic into `lib/workflow-definitions.js` so CRUD, precedence, and launch-time override behavior stay shared between the command handler and feature launch paths.
- Used one resolved effective workflow per slug in `workflow list/show`; higher-precedence project definitions shadow matching global/built-in slugs.
- Treated explicit CLI inputs as authoritative for a single run. Saved workflows provide defaults; they do not block positional agents or explicit `--eval-agent` / `--review-agent` / `--stop-after`.
- Built-in starter workflows were defined in code and kept read-only so they are always available even when no user-defined files exist.

## Conversation Summary
- The user asked for full implementation of feature 266 from the existing worktree using `aigon feature-do 266`.
- Implementation stayed inside the current worktree, used `aigon` directly, signaled `implementing`, and avoided re-running `feature-start`.
- The feature was implemented end-to-end, including tests/docs/log updates, before preparing final submission.

## Issues Encountered
- The first CLI round-trip test for `workflow create` failed because the command incorrectly treated optional fields as interactive-only requirements. Fixed by making non-interactive creation require only schema-required fields.
- Full `npm test` is currently blocked by an existing unrelated failure in `tests/integration/pro-gate.test.js` in this environment (`AIGON_FORCE_PRO` expectations fail because `isProAvailable()` returns `false`). The new workflow-definition integration test passes.
