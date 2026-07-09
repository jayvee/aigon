---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T00:47:16.787Z", actor: "cli/feature-prioritise" }
---

# Feature: clean stray close commit artifacts

## Summary
Two stray files from the git-branch-storage close cycle are still present on main: `tests/unit/home-env-hygiene.test.js` from orphaned F545 work and `docs/specs/feedback/01-inbox/feedback-16-t.md`, an accidental empty feedback stub. The broad close auto-commit class has since been addressed by `lib/close-commit-classify.js` and the `feature-close` explicit staging/warning path, so this feature is now only the remaining cleanup and verification.

## User Stories
- [ ] As a maintainer, `npm run test:unit` on a clean main checkout has no failures caused by tests for code that doesn't exist on main.
- [ ] As a maintainer, the feedback inbox no longer contains empty accidental stubs that look like real user feedback.

## Acceptance Criteria
- [ ] `tests/unit/home-env-hygiene.test.js` is removed from main (or, if the F545 hygiene helpers are genuinely wanted, that is a separate decision — default here is removal with a pointer to the orphaned `b73d98a5e` commit in the commit message).
- [ ] `docs/specs/feedback/01-inbox/feedback-16-t.md` is removed via the proper feedback path (it is an empty accidental stub; check whether feedback files require a CLI-mediated deletion before using `git rm`).
- [ ] Confirm the already-shipped close auto-commit guard still has regression coverage: `tests/unit/close-commit-classify.test.js` covers stray classification and `lib/feature-close.js` calls `warnStrayFilesBeforeAutoCommit` before drive/worktree auto-commit.
- [ ] Do not broaden the scope into another close-path refactor unless that verification fails.
- [ ] `npm run test:core` passes with zero unit failures attributable to stray artifacts.

## Validation
```bash
node -c aigon-cli.js
npm run test:unit
```

## Technical Approach
- Delete only the two named artifacts.
- Run the focused close-commit classification test before and after the cleanup.
- Record in the implementation log that the class fix was already present at feature start, with the current code/test references.

## Dependencies
-

## Out of Scope
- Fixing `agent-prompt-resolver` (gg) and `autonomous-triplets` failures — separate pre-existing issues, not from this class.
- Restoring the F545 home-hygiene helpers.
- Adding a blocking prompt for stray auto-commit files.

## Open Questions
- None.

## Related
- Research: —
- Set: —
- Prior art: stray commits `4334a00fe`, `585c3a656`; orphaned F545 commit `b73d98a5e`; `.env.local` close-filter feedback rule; review findings 2026-07-07.
