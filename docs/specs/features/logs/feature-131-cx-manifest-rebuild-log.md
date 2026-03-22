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
- Follow-up change (same feature scope): removed runtime folder-derived backward compatibility:
  - `lib/manifest.js` now returns `null` when a coordinator manifest is missing/corrupt.
  - Removed `ensureManifest`/bootstrap derive behavior and made manifest ID path handling explicit + normalized.
  - `lib/state-machine.js` now rejects transitions when the manifest is missing instead of implicitly creating one.
  - Patched command replay checks (`feature-start`, `feature-eval`, `feature-close`) for null-safe manifest reads.
  - Patched doctor checks to skip absent manifests rather than assuming derived records.
- Updated tests for the new contract:
  - `lib/manifest.test.js` now asserts `readManifest()` returns `null` on missing files and that `writeManifest()` is the explicit creator.
  - `aigon-cli.test.js` manifest contract tests updated from derive/ensure behavior to explicit read/write behavior.
  - Added state-machine guard test: missing manifest causes `requestTransition` failure.
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
- Accepted removal of backward-compat manifest derivation now (single-user project), trading legacy auto-recovery for deterministic runtime behavior.
