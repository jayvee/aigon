# Feature: feature-close-scan-target-branch

## Summary
`aigon feature-close` currently runs its merge-gate security scan against the caller's current checkout (`default...HEAD` plus staged files in `cwd`) instead of the branch/worktree that is actually being closed. In repos that have both a stale drive-style branch and a live single-agent worktree branch, this causes false blockers: `feature-close <id> <agent>` can report Semgrep findings from the wrong branch even when the target worktree has already fixed them. This feature makes the security scan target explicit and correct for `feature-close`, so the scan evaluates the implementation being merged rather than unrelated local state.

## User Stories
- [ ] As a user closing a single-agent worktree feature, I want the security gate to scan the agent worktree branch I am merging, not whichever branch happens to be checked out in the main repo.
- [ ] As a maintainer debugging a blocked close, I want the reported findings to correspond to the actual feature branch under close so the scanner output is actionable.
- [ ] As a reviewer of security-gate behavior, I want regression coverage for branch/worktree targeting so future close-flow changes do not silently reintroduce false blockers.

## Acceptance Criteria
- [ ] `aigon feature-close <id> <agent>` runs the security scan against the target agent branch/worktree snapshot, not against unrelated changes in the caller's current checkout.
- [ ] `aigon feature-close <id>` in ordinary Drive branch mode continues to scan the current feature branch diff versus the default branch.
- [ ] If a single-agent worktree branch fixes a Semgrep finding that still exists on a stale drive-style sibling branch, closing the worktree branch is not blocked by findings from that stale branch.
- [ ] The scan snapshot includes the target branch's committed changes and any staged-but-uncommitted changes in that target worktree, so the gate still reflects what would be merged if `feature-close` auto-commits first.
- [ ] Scanner output paths and findings remain readable and attributable to the target branch/worktree under close.
- [ ] Regression tests cover at least:
- [ ] close from a repo whose main checkout is on a different feature branch while the target is a worktree branch
- [ ] close from a normal Drive branch with no worktree
- [ ] a stale sibling branch reproducing the old false-positive behavior before the fix and no longer reproducing it after
- [ ] A focused code review confirms the fix does not weaken the security gate by accidentally scanning an empty snapshot or skipping staged changes from the actual target branch.

## Validation
```bash
node -c lib/security.js
node -c lib/feature-close.js
node tests/integration/feature-close-restart.test.js
```

## Technical Approach
Audit how `feature-close` chooses the branch/worktree to merge and how `runSecurityScan()` constructs its diff snapshot. Then thread the resolved close target into the scan step so the security gate runs in the correct repository context.

Expected direction:
- Make `mergeFeatureBranch()` pass an explicit scan context derived from the resolved close target, not just `process.cwd()`.
- For worktree-backed closes, the scan context should be the target worktree path (or an equivalent explicit branch snapshot) so `default...HEAD` and staged files reflect the agent branch being merged.
- For plain Drive branch closes, preserve the current behavior when the feature branch is the active checkout.
- Add tests around the target-selection logic rather than relying on manual branch arrangement.

Unintended consequences to guard against:
- A naive fix that only switches `cwd` could miss staged changes if those changes live in a different checkout than the one Aigon later auto-commits.
- A naive fix that scans the wrong checkout but merges the right branch gives users misleading blockers; the scan and merge target must stay aligned.
- A fix must not silently broaden scope and scan unrelated dirty files from the main repo after switching to the target worktree.
- Any test harness should model the stale-drive-branch case explicitly, because that is what made the bug visible in practice.

## Dependencies
- Existing merge-gate scanner infrastructure in [security.js](/Users/jviner/src/aigon/lib/security.js)
- Existing close orchestrator in [feature-close.js](/Users/jviner/src/aigon/lib/feature-close.js)
- Semgrep-based security gate introduced by [feature-149-security-scan-sast.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-149-security-scan-sast.md)

## Out of Scope
- Rewriting Semgrep rule policy or changing severity thresholds
- Fixing every existing Semgrep warning in the codebase surfaced once the correct target branch is scanned
- Removing stale sibling branches in general; that remains a separate branch-shape cleanup problem
- Broader `feature-close` work unrelated to scan-target correctness

## Open Questions
- Should the fix pass an explicit `cwd` to `runSecurityScan()`, or should the snapshot builder take an explicit `{ baseRef, targetRef, stagedFromPath }` model so the target is unambiguous?
- Do `feature-submit` or `research-close` have similar target-selection bugs when run from non-default checkouts, or is this specific to `feature-close` worktree delegation?
- Should this fix also add diagnostic output such as "Scanning target branch: feature-244-cx-..." for easier debugging?

## Related
- Research:
- [security.md](/Users/jviner/src/aigon/docs/security.md)
- [feature-close.js](/Users/jviner/src/aigon/lib/feature-close.js)
- [security.js](/Users/jviner/src/aigon/lib/security.js)
