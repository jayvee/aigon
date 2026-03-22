# Implementation Log: Feature 131 - manifest-rebuild
Agent: cx

## Plan
- Rework `feature-prioritise` to rebuild coordinator manifests deterministically so stale `stage: done` state cannot block a new lifecycle.
- Preserve non-persistent dashboard reads (`readManifest`) and add a lifecycle regression test that simulates polling between commands.
- Validate by running syntax checks and CLI tests in this worktree.

## Progress
- Executed `aigon feature-do 131` in Drive worktree mode and confirmed target spec/log.
- Updated `lib/commands/feature.js`:
  - `feature-prioritise` now captures moved spec path and calls `manifest.writeManifest(...)` with canonical backlog state.
  - This explicitly resets `stage`, `pending`, `agents`, and `winner`, preventing stale coordinator manifests from previous runs.
- Added regression test in `aigon-cli.test.js`:
  - Runs `feature-create -> feature-prioritise -> feature-start -> feature-close` for 5 cycles.
  - Seeds a stale `feature-01.json` with `stage: done` before cycle 0.
  - Simulates dashboard polling by repeatedly calling `readManifest` between prioritise and start.
  - Asserts `feature-start` never reports `Invalid transition`.
- Installed worktree dependencies with `npm install`.
- Verified syntax: `node -c lib/commands/feature.js` and `node -c aigon-cli.test.js`.
- Ran `node aigon-cli.test.js`; baseline suite has unrelated pre-existing failures, and the new lifecycle regression test passes.

## Decisions
- Kept dashboard polling read-only; no creation/modification path was added to dashboard code.
- Fixed stale-state root cause at the explicit command boundary (`feature-prioritise`) instead of reintroducing background reconciliation.
- Wrote the regression in the core CLI test suite (`aigon-cli.test.js`) so repeated lifecycle reliability is continuously checked.
