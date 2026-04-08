# Feature: feature-close-spec-commit-boundaries

## Summary
`aigon feature-close` currently has a dangerous boundary bug: the final "move spec and logs" commit can absorb unrelated staged or unresolved files that were left in the main repo index after the merge phase. This has already produced downstream damage outside the spec tree, including repeated accidental edits to `app/manifest.yml` in a consumer repo during closes that should only have moved markdown files. This feature hardens the close flow so the post-merge metadata commit is isolated to explicit workflow-owned files, preserves the user's existing worktree/index state on `main`, and fails loudly when unrelated conflicts remain instead of silently sweeping them into the close commit.

## User Stories
- [ ] As a maintainer closing a feature, I want the final close-time commit to touch only spec/log/dependency-graph files so Aigon cannot mutate application code while finishing workflow bookkeeping.
- [ ] As a user who has unrelated work in progress on `main`, I want `feature-close` to preserve that local state instead of restaging or recommitting it during the spec-move phase.
- [ ] As a maintainer debugging a failed close, I want an explicit error when unrelated conflicts or staged files would contaminate the metadata commit so the repo is not silently mangled.

## Acceptance Criteria
- [ ] The post-merge close commit created by `aigon feature-close` contains only workflow-owned paths: the moved feature spec, the feature's logs/evaluation files, and any dependency-spec files intentionally rewritten by dependency-graph refresh.
- [ ] If unrelated files are already staged on `main` before the spec-move phase begins, `feature-close` preserves both their content and their staged/unstaged state after close; they are not included in the close commit.
- [ ] If the merge leaves unrelated unmerged files outside the workflow-owned path set, `feature-close` aborts with a clear error instead of auto-resolving them during the spec-move phase.
- [ ] Auto-resolution that still exists for the merge phase remains limited to the merge itself; the later spec-move phase does not silently run broad conflict resolution across arbitrary repository files.
- [ ] Regression tests cover at least:
- [ ] a staged non-spec file on `main` surviving close without being committed
- [ ] an unrelated conflicted file causing close to stop before the metadata commit
- [ ] a normal close still producing the expected spec/log move commit
- [ ] The implementation documents the invariant in code comments or nearby docs so future `feature-close` refactors preserve the boundary between "implementation merge" and "workflow bookkeeping commit".

## Validation
```bash
node -c lib/feature-close.js
node tests/integration/feature-close-spec-commit-scope.test.js
node tests/integration/lifecycle.test.js
node tests/integration/feature-close-restart.test.js
```

## Technical Approach
Treat the spec-move commit as a separate transaction with its own isolated path set, rather than trusting the repository index left behind by earlier merge logic.

Preferred implementation direction:
- Build the close commit from an explicit file set only, using either an isolated temporary index or another mechanism that preserves the user's existing index state on `main`.
- Compute an allowlist for the close-time commit:
- the moved feature spec
- that feature's logs and evaluation file
- dependency specs intentionally rewritten by `refreshFeatureDependencyGraphs()`
- Before creating the commit, inspect the repository for staged or unmerged files outside that allowlist.
- If unrelated files are present, abort with a targeted error that explains which files are blocking the close and why Aigon is refusing to continue.
- Keep merge-phase behavior separate from bookkeeping-phase behavior. If merge conflict auto-resolution remains, it must not bleed into the later metadata commit code path.

Important edge cases and unintended consequences to account for:
- Preserving index shape matters, not just file content. A naive `git reset HEAD --` before staging would protect the close commit but would also discard the user's staged intent on `main`, which is a behavioral regression.
- Rename handling must still work for the feature spec move. The implementation cannot accidentally convert the move into a delete-only or add-only commit.
- Dependency-graph refresh may legitimately rewrite other feature specs. Those rewrites are allowed, but only when they are explicitly produced by the workflow-owned refresh step.
- Resumed closes must follow the same safety rules as fresh closes; the resume path cannot bypass the commit-boundary checks.
- Dashboard-triggered closes and terminal-triggered closes should share the same safe behavior because they both route through `lib/feature-close.js`.

## Dependencies
- Incident report from farline-ai-forge while running Aigon `2.50.43`
- Existing `feature-close` modularization in `lib/feature-close.js`

## Out of Scope
- Rewriting the entire merge strategy used earlier in `feature-close`
- Changing how implementation work is auto-committed on the feature branch or worktree, unless the investigation proves that path shares the same root cause
- Automatically repairing already-corrupted historical close commits in downstream repos
- Broad workflow-engine changes unrelated to close-time git/index safety

## Open Questions
- Should the implementation preserve the user's index by using a temporary index file, or is there a simpler pathspec-based commit strategy that fully preserves staged intent across rename/delete cases?
- Do we want an opt-in escape hatch for maintainers to force the close despite unrelated staged files, or should the command remain strictly safe-by-default with no bypass?
- Should the blocking error mention likely recovery commands, or is listing the offending files sufficient?

## Related
- Research:
- [feature-close.js](/Users/jviner/src/aigon/lib/feature-close.js)
- [feature-127-cc-manifest-and-branch-safety-log.md](/Users/jviner/src/aigon/docs/specs/features/logs/feature-127-cc-manifest-and-branch-safety-log.md)
