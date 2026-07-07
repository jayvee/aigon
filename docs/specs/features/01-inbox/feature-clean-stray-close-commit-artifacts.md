---
complexity: medium
---

# Feature: clean-stray-close-commit-artifacts

## Summary
Two "feat: implementation for feature NNN" commits in the git-branch-storage set merged **stray working-tree files that have nothing to do with their features**: `4334a00fe` (F609) added `tests/unit/home-env-hygiene.test.js`, which tests `resolveSafeHome`/`looksLikePoisonedHome` from an F545 commit (`b73d98a5e`) that never landed on main — so **main now has a permanently failing unit test**; `585c3a656` (F610) added `docs/specs/feedback/01-inbox/feedback-16-t.md`, an empty accidental feedback stub titled "T". This feature removes both instances and fixes the class: the close/submit auto-commit path sweeps *all* uncommitted files in the worktree into the feature's implementation commit instead of scoping to (or at least warning about) files unrelated to the feature's changes. Found by the F609–613 implementation review, 2026-07-07.

## User Stories
- [ ] As a maintainer, `npm run test:unit` on a clean main checkout has no failures caused by tests for code that doesn't exist on main.
- [ ] As an operator closing a feature, files that happen to be sitting in the worktree but were never part of the feature's work don't silently ride into the merge — I get a visible list and a deliberate choice.

## Acceptance Criteria
- [ ] `tests/unit/home-env-hygiene.test.js` is removed from main (or, if the F545 hygiene helpers are genuinely wanted, that is a separate decision — default here is removal with a pointer to the orphaned `b73d98a5e` commit in the commit message).
- [ ] `docs/specs/feedback/01-inbox/feedback-16-t.md` is removed via the proper feedback path (it is an empty accidental stub; check whether feedback files require a CLI-mediated deletion before using `git rm`).
- [ ] The close/submit auto-commit path (`lib/feature-close.js` auto-commit, and the worktree submit equivalent) prints the file list it is about to commit and flags files outside the feature's touched-path set (heuristic: paths never modified by the feature's branch commits) — at minimum a loud warning naming the stray files; ideally a prompt/flag (`--include-untracked-strays`) gate. Keep `.env.local` filtering behaviour intact (existing feedback rule).
- [ ] A regression test covers the stray-file warning path (unit-level on the file-classification helper is sufficient).
- [ ] Pre-existing unrelated unit failures (`agent-prompt-resolver` gg case, `autonomous-triplets` registry drift) are explicitly out of scope here but must not be masked: this feature's log records their status at time of work.
- [ ] `npm run test:core` passes with zero unit failures attributable to stray artifacts.

## Validation
```bash
node -c aigon-cli.js
npm run test:unit
```

## Technical Approach
- Instance cleanup is two deletions; the substance is the class fix in the auto-commit path. Trace both Drive-branch and worktree-submit flows before changing either (full-flow tracing rule) — the sweep likely lives in the auto-commit block of `lib/feature-close.js` (~lines 340–410) and its submit sibling.
- Consider whether the correct default is to *exclude* untracked files entirely from close auto-commit (they can never be the feature's work if the feature only edited tracked paths?) — validate against real flows (agents do create new files legitimately) before narrowing; a warn-and-include default with an explicit stray list is the safe first step.

## Dependencies
-

## Out of Scope
- Fixing `agent-prompt-resolver` (gg) and `autonomous-triplets` failures — separate pre-existing issues, not from this class.
- Restoring the F545 home-hygiene helpers.

## Open Questions
- Should stray detection block close in autonomous (AutoConductor) runs where nobody is present to answer a prompt? Recommended: warn-and-include in autonomous mode, never block.

## Related
- Research: —
- Set: —
- Prior art: stray commits `4334a00fe`, `585c3a656`; orphaned F545 commit `b73d98a5e`; `.env.local` close-filter feedback rule; review findings 2026-07-07.
