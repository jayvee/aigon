# Implementation Log: Feature 284 - codex-awaiter-approval-bypass
Agent: cx

## Plan
- Confirm the current Codex approval model from local CLI/docs, then wire the fix into Aigon's cx install and worktree trust path.
- Backfill trust for existing worktrees, register new worktrees at creation time, and remove trust entries during cleanup.
- Add a regression test around Codex trust-file writes/removal and update cx-facing docs.

## Progress
- Verified in current Codex docs/CLI that subagents inherit the parent session's approval and sandbox policy; there is no separate awaiter-only config key.
- Found Aigon already writes `.codex/config.toml` with `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`, but `install-agent` only pre-seeded trust for the parent `~/.aigon/worktrees/<repo>` directory. Codex trust is exact-path TOML sections, so child worktrees were not covered by that base entry.
- Updated `lib/agent-registry.js` to write and remove exact Codex TOML project-trust entries.
- Updated `lib/worktree.js` to register Codex trust during worktree setup and to remove Codex trust entries during worktree cleanup/reset.
- Updated `lib/commands/setup.js` so `init` / `install-agent` backfill trust for existing worktrees under `~/.aigon/worktrees/<repo>/*` when cx is installed.
- Added regression coverage in `tests/integration/agent-registry-contract.test.js`.
- Updated cx docs/template commentary to document the actual fix shape and maintenance expectations.

## Decisions
- Treat the "awaiter approval" fix as a documented setting combination, not a new hidden config key: project `.codex/config.toml` plus exact worktree trust in `~/.codex/config.toml`.
- Keep the backfill idempotent and piggyback it on existing setup/install flows instead of introducing a separate migration command.
- Remove only worktree trust entries during cleanup so the main repo trust entry remains intact.
- Normalize the regression test around the actual canonical paths returned by `process.cwd()` / `path.resolve()` on macOS temp dirs (`/private/var` vs `/var`), since the behavior was correct and the initial test expectation was not.

## Conversation Summary
- The user asked to continue implementing feature 284 from the existing worktree.
- I verified the workspace, attached via `aigon feature-do 284`, marked the feature as implementing, and implemented the Codex trust/backfill fix plus docs/tests.

## Issues Encountered
- Initial regression assertions failed because macOS temp directories canonicalized the repo path differently than the literal temp path string. I updated the test to assert against the resolved paths Codex actually sees.
