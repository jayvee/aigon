# Implementation Log: Feature 278 - entity-spec-review
Agent: cx

## Plan
- Add a shared rubric placeholder and four canonical command templates for feature/research spec review and author-side check.
- Wire CLI launch support for the new commands, including cx inline prompt resolution and dashboard session launches.
- Surface git-history-backed pending spec-review metadata in the dashboard without per-entity `git log --follow` calls.
- Add integration coverage for prompt resolution and pending-review badge/action derivation.

## Progress
- Added `feature-spec-review`, `feature-spec-review-check`, `research-spec-review`, and `research-spec-review-check` to the command registry, prompt resolver, feature/research command handlers, dashboard action mapping, and dashboard launch endpoints.
- Added `templates/generic/prompts/spec-review-rubric.md` and inlined it into the four new command templates through `processTemplate()`.
- Extended dashboard state collection to scan repo spec history once per HEAD, derive pending spec-review counts/reviewer ids, and expose both the badge and action eligibility on feature/research cards.
- Added integration tests for cx prompt inlining and spec-review status/action derivation across pending, rename, and acknowledged states.
- Restarted the AIGON server after the backend edits with `aigon server restart`.
- Resumed the feature from a stalled Codex tmux session, verified the existing implementation commit, and carried the remaining fixes directly in the worktree.
- Fixed dashboard pending-review detection so empty `spec-review-check:` acknowledgement commits still clear pending badges/actions while rename history continues to resolve correctly.
- Fixed `spec-reconcile` to return the expected skip response for unknown workflow lifecycles instead of surfacing a 500 from path resolution.
- Reran `npm test` after the fixes and got a clean pass.

## Decisions
- Kept spec-review state git-history-backed instead of introducing a second workflow/state file. Pending reviews are derived from `spec-review:` commits newer than the latest `spec-review-check:` commit on the spec.
- Used a centralized rubric include (`{{SPEC_REVIEW_RUBRIC}}`) so command templates and cx inline prompts stay in sync with one source of truth.
- Added dashboard-specific spec-review actions through workflow rules and snapshot action descriptors, but computed pending-review metadata in the dashboard collector using a path-history scan plus a repo-wide acknowledgement scan, both cached per HEAD.
- Used dedicated dashboard endpoints for spec-review/spec-review-check session launch instead of overloading the existing `feature-open`/`research-open` modes.
- Reused the existing agent picker modal for both dashboard actions. That keeps the UX consistent and avoids frontend-only eligibility logic.
