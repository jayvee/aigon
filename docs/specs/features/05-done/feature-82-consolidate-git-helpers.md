# Feature: consolidate-git-helpers

## Summary
Extract all git operations from `lib/utils.js`, `lib/validation.js`, `lib/board.js`, and `lib/commands/shared.js` into a single `lib/git.js` module. This eliminates duplicate code paths that cause recurring bugs — most recently, `.env.local` blocking feature-close because `getGitStatusPorcelain()` and `getWorktreeStatus()` were independent implementations with different filtering logic.

## User Stories
- [ ] As a developer, I want one place to maintain git helper functions so that bug fixes (like .env filtering) apply everywhere automatically
- [ ] As an agent, I want git operations to be injectable/mockable so that tests don't need to shell out to real git

## Acceptance Criteria
- [ ] New `lib/git.js` module exists with all git helper functions
- [ ] `getGitStatusPorcelain()` removed from `lib/validation.js`, replaced by import from `lib/git.js`
- [ ] `getWorktreeStatus()` removed from `lib/utils.js`, replaced by import from `lib/git.js`
- [ ] `runGit()` removed from `lib/utils.js`, replaced by import from `lib/git.js`
- [ ] `getCurrentBranch()` consolidated (exists in both `lib/board.js` and `lib/utils.js`)
- [ ] `findWorktrees()` / `filterByFeatureId()` moved from `lib/utils.js` to `lib/git.js`
- [ ] `getCurrentHead()` moved from `lib/validation.js` to `lib/git.js`
- [ ] `getChangedFilesInRange()` / `getCommitSummariesInRange()` moved from `lib/validation.js` to `lib/git.js`
- [ ] All inline `execSync('git ...')` calls in `lib/commands/shared.js` replaced with named functions from `lib/git.js`
- [ ] All inline `execSync('git ...')` calls in `lib/board.js` replaced with imports from `lib/git.js`
- [ ] `.env` file filtering lives in exactly ONE place (inside `getGitStatus()`)
- [ ] `createAllCommands()` scope destructures git functions so they remain injectable for tests
- [ ] All 156 existing tests pass
- [ ] No inline `execSync('git ...')` remains in any file except `lib/git.js`

## Validation
```bash
node -c lib/git.js
node -c lib/utils.js
node -c lib/validation.js
node -c lib/commands/shared.js
node -c lib/board.js
node --test aigon-cli.test.js
grep -r "execSync.*'git " lib/commands/shared.js lib/utils.js lib/validation.js lib/board.js | grep -v "lib/git.js" | grep -c . | xargs test 0 -eq
```

## Technical Approach

### Current state (the problem)
Git operations are scattered across 4 files with 30+ inline `execSync('git ...')` calls:
- `lib/validation.js`: `getCurrentHead()`, `getGitStatusPorcelain()`, `getChangedFilesInRange()`, `getCommitSummariesInRange()`, `ensureRalphCommit()`, plus inline calls in `runSmartValidation()`
- `lib/utils.js`: `getWorktreeStatus()`, `runGit()`, `findWorktrees()`, `filterByFeatureId()`, `getCurrentBranch()`, plus inline calls in `detectDevServerContext()`, `detectDashboardContext()`, etc.
- `lib/board.js`: `getCurrentBranch()` (duplicate!), inline `execSync('git worktree list')`
- `lib/commands/shared.js`: 10+ inline `execSync('git ...')` calls for branch detection, worktree listing, status checks

### Target state
```
lib/git.js (new, ~200 lines)
├── getStatus(cwd?)          — porcelain status with .env filter (replaces both getGitStatusPorcelain + getWorktreeStatus)
├── run(command, opts?)      — wrapper around execSync('git ...') (replaces runGit)
├── getCurrentBranch(cwd?)   — consolidated from utils + board
├── getCurrentHead()         — moved from validation.js
├── getDefaultBranch()       — extracted from inline in feature-close
├── listWorktrees()          — moved from utils.js (was findWorktrees)
├── filterWorktreesByFeature(worktrees, id) — moved from utils.js
├── getChangedFiles(from, to) — moved from validation.js
├── getCommitSummaries(from, to) — moved from validation.js
├── listBranches()           — extracted from inline in feature-close/cleanup
└── ensureCommit(msg, opts?) — moved from validation.js (was ensureRalphCommit), generalized
```

### Migration approach
1. Create `lib/git.js` with all functions, keeping original names as aliases for backward compatibility
2. Update imports in each consumer file one at a time
3. Remove old implementations after all consumers are migrated
4. Add git functions to `createAllCommands()` scope so they're injectable in tests
5. Update tests to use the new module

### Key constraint
All functions must remain synchronous (they use `execSync`) — this is intentional for CLI simplicity.

## Dependencies
- None — pure internal refactor

## Out of Scope
- Async git operations
- Adding new git functionality
- Changing the `createAllCommands` dependency injection pattern itself
- Refactoring `lib/utils.js` beyond removing git functions

## Open Questions
- Should `ensureRalphCommit` stay in validation.js since it's ralph-specific logic that happens to use git? Or should git.js export a generic `commitIfDirty()` and ralph calls that?

## Related
- Feedback: [.env.local should not block feature-close](../../../.claude/projects/-Users-jviner-src-aigon/memory/feedback_env_local_ignored.md)
- Fix: commit e11edd6 (idle timeout), commit 9b47dd4 (.env filter in getGitStatusPorcelain)
