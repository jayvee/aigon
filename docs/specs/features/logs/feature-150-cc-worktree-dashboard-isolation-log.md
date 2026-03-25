---
status: submitted
updated: 2026-03-26T00:00:00Z
---
# Implementation Log: Feature 150 - worktree-dashboard-isolation
Agent: cc

## Plan

Replace scattered `assertOnDefaultBranch()` calls with a declarative action scope model. Each command declares its scope (`main-only`, `feature-local`, `any`) and a single gatekeeper enforces it. Dashboard and other read-only commands can run from anywhere. Main-only actions delegate to the main repo via subprocess when triggered from a worktree.

## Progress

- Created `lib/action-scope.js` with ACTION_SCOPES map, `buildActionContext()`, and `assertActionAllowed()` gatekeeper
- Replaced all 10 `assertOnDefaultBranch()` call sites across `lib/entity.js`, `lib/commands/feature.js`, and `lib/commands/feedback.js`
- Added delegation pattern: main-only actions from worktrees spawn `node aigon-cli.js <action>` in the main repo instead of refusing
- Removed branch gate from feedback commands (feedback-create, feedback-triage now scope: any)
- Changed dashboard worktree guard from hard block to informational message
- Added `DASHBOARD_PORT` to worktree `.env.local` (written by `setupWorktreeEnvironment`)
- Dashboard `start` and `restart` now check `DASHBOARD_PORT` env var first
- Extended `manifest.js` `readManifest()` and `readAgentStatus()` with `{ mainRepoPath }` option for worktree state access
- Added `getMainRepoPath()` and `isInsideWorktree()` helpers to `lib/git.js`
- Wrote 22 unit tests for the action scope module (all pass)
- Full test suite: 0 regressions (17 pre-existing failures unchanged)

## Decisions

- **Scope defaults to `main-only`** for unknown actions — safe by default
- **Delegation uses subprocess** (`execSync` with `stdio: inherit`) rather than in-process execution — keeps the worktree process clean and avoids state contamination
- **Feedback commands are scope `any`** — they only read/write local files, no shared state mutation
- **Dashboard worktree guard changed to info** (not error) — spec says dashboard should run from anywhere
- **`readManifest`/`readAgentStatus` backward-compatible** — new `options` parameter is optional, existing callers unaffected
- **`assertOnDefaultBranch()` kept in git.js** — not deleted, just no longer called; may be useful as a utility

## Code Review

**Reviewed by**: gg (Gemini)
**Date**: 2026-03-26

### Findings
- `lib/manifest.js`: `writeManifest`, `writeAgentStatus`, and locking functions did not support the `options.mainRepoPath` redirection. This could lead to state fragmentation when agents in worktrees write status to their local `.aigon/state` while the dashboard reads from the main repo.
- Redundant logic: `writeAgentStatusAt` was functionally similar to a redirected `writeAgentStatus`.

### Fixes Applied
- Updated `lib/manifest.js`: Added `options` support to all path helpers and write/lock functions.
- Updated `lib/manifest.test.js`: Added unit tests for `mainRepoPath` redirection of manifests and locks.

### Notes
- The `action-scope.js` implementation is excellent and correctly handles command delegation.
- Dashboard port hashing and worktree isolation are robust.
- `writeAgentStatusAt` remains for backward compatibility but is now a wrapper or similar to redirected `writeAgentStatus`.
