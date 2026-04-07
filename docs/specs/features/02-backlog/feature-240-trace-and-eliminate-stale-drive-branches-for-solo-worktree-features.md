# Feature: trace-and-eliminate-stale-drive-branches-for-solo-worktree-features

## Summary
Recent Codex solo-worktree features have shown a dangerous branch-shape regression: a stale drive-style branch (`feature-<id>-<slug>`) can exist alongside the real worktree branch (`feature-<id>-<agent>-<slug>`). When that happens, downstream commands such as `feature-close` can resolve or merge the wrong branch, leaving the feature marked done without the implementation actually landing on `main`. This feature traces where those stale drive branches are being created or selected, removes that behavior across all start/open/autonomous entry points, and adds detection plus recovery guidance so branch state is trustworthy again.

## User Stories
- [ ] As a user starting a single-agent worktree feature, I want Aigon to create exactly one implementation branch so close/review/status flows cannot target a stale branch by accident.
- [ ] As a maintainer debugging workflow issues, I want `feature-status`/`doctor` to detect stale drive-style branches for solo worktree features so recovery is explicit instead of implicit.

## Acceptance Criteria
- [ ] Running `aigon feature-start <id> <agent>` for a single-agent worktree never creates or checks out `feature-<id>-<slug>` in the main repo.
- [ ] Single-agent worktree features consistently use `feature-<id>-<agent>-<slug>` as the implementation branch across CLI, dashboard launch, and autonomous flows.
- [ ] Re-running `feature-start`, `feature-open`, or related launch/re-attach commands for a single-agent worktree does not create, resurrect, or prefer a stale drive-style branch.
- [ ] Automated tests cover the regression path that previously produced stale drive-style branches for Codex solo-worktree features.
- [ ] `feature-status`, `doctor`, or another explicit diagnostic surface warns when a stale drive-style branch exists alongside exactly one worktree branch for the same feature.
- [ ] Recovery guidance is documented or emitted by the diagnostic path so users can safely remove stale branches without guessing.

## Validation
```bash
node -c lib/commands/feature.js
node -c lib/feature-close.js
node tests/integration/lifecycle.test.js
```

## Technical Approach
- Audit every code path that can start, re-open, auto-launch, or auto-close a solo worktree feature.
- Trace the exact point where a drive-style branch is created, checked out, or preferred for `solo_worktree` features with one explicit agent.
- Remove the stale branch creation path instead of relying only on close-time recovery.
- Add invariant-focused tests around branch naming and branch selection so future workflow changes cannot silently reintroduce mixed drive/worktree branch state.
- Add a lightweight detection path for already-damaged repositories so existing stale branches are visible and recoverable.

## Dependencies
- Feature 235 / 236 / 239 close regression audit findings (April 7, 2026)

## Out of Scope
- Backfilling or repairing every already-closed historical feature automatically
- Rewriting feature logs or re-merging historical implementations as part of the fix itself
- Changing multi-agent Fleet branch naming rules unless the audit proves they share the same root cause

## Open Questions
- Which exact command path is creating or checking out the stale drive-style branch: `feature-start`, `feature-open`, dashboard action handling, or an autonomous launcher?
- Should stale-branch detection live in `doctor`, `feature-status`, or both?

## Related
- Research:
