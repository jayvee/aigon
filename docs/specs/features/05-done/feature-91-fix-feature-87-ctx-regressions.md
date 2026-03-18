# Feature: fix-feature-87-ctx-regressions

## Summary

Feature 87 restructured the command system to use a `ctx` object pattern where domain modules are accessed as `ctx.git`, `ctx.utils`, `ctx.board`, etc. During migration, several functions from `lib/board.js` were incorrectly placed in the `ctx.utils` destructuring instead of `ctx.board`, and one function from `lib/validation.js` was also misrouted. These regressions cause runtime `TypeError` crashes when the affected commands are invoked.

## User Stories
- [x] As a user, I want `aigon feature-do` and `aigon feature-setup` to work without crashing
- [x] As a user, I want `aigon research-do` and `aigon research-setup` to work without crashing
- [x] As a user, I want `aigon board` to work without crashing
- [x] As a user, I want `aigon init` and `aigon install-agent` to work without crashing

## Acceptance Criteria
- [x] `loadBoardMapping` in `feature.js` destructured from `ctx.board` (not `ctx.utils`)
- [x] `loadBoardMapping` in `research.js` destructured from `ctx.board` (not `ctx.utils`)
- [x] `displayBoardKanbanView` and `displayBoardListView` in `infra.js` destructured from `ctx.board` (not `ctx.utils`)
- [x] `ensureBoardMapInGitignore` in `setup.js` destructured from `ctx.board` (not `ctx.utils`)
- [x] `getGitStatusPorcelain` dead destructure from `ctx.utils` in `feature.js` removed (already aliased from `ctx.validation`)
- [x] All existing tests pass

## Validation
```bash
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/commands/infra.js
node -c lib/commands/setup.js
node --test aigon-cli.test.js
```

## Technical Approach

The `buildCtx()` in `shared.js` exposes board functions via `ctx.board`, not `ctx.utils`. Functions that were in the old flat `shared.js` and moved to `lib/board.js` during an earlier refactor were incorrectly left pointing at `ctx.utils` during the feature 87 migration.

**Affected command files and their fixes:**
- `lib/commands/feature.js` — removed `loadBoardMapping` and `getGitStatusPorcelain` from `ctx.utils` destructure; added `ctx.board` block for `loadBoardMapping`
- `lib/commands/research.js` — removed `loadBoardMapping` from `ctx.utils` destructure; added `ctx.board` block for `loadBoardMapping`
- `lib/commands/infra.js` — removed `displayBoardKanbanView` and `displayBoardListView` from `ctx.utils` destructure; added `ctx.board` block for both
- `lib/commands/setup.js` — removed `ensureBoardMapInGitignore` from `ctx.utils` destructure; added `ctx.board` block for it

## Dependencies
- Feature 87: restructure-command-system (the source of the regressions)

## Out of Scope
- Fixing regressions in other modules not discovered here
- Refactoring ctx structure beyond targeted fixes

## Related
- Feature 87: restructure-command-system (done)
- `fix: add runGit alias to git.js exports` (feature 87 regression, already fixed in main)
- `fix: destructure detectWorktreeFeature from ctx.git in feature.js` (feature 87 regression, already fixed in main)
