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

## Code Review

**Reviewed by**: cc
**Date**: 2026-04-19

### Findings
- **Commit format drift from AC**: spec AC prescribes colon separator — `spec-review: feature <ID>: <summary>` — explicitly to avoid cross-keyboard em-dash issues. The templates (`templates/generic/commands/feature-spec-review.md` line 41, plus the three siblings) emit em-dash `—` and the parser regex in `lib/dashboard-status-collector.js` (`parseSpecReviewSubject`) only accepts em-dash or hyphen, not colon. Implementation is internally consistent (template, parser, and tests all use em-dash) but drifts from the AC. User should decide whether to update templates+regex to colon format or update the spec AC.
- **Empty-commit "no changes" reviews are silently dropped by the dashboard**: AC requires `git commit --allow-empty` with a `spec-review:` subject when the reviewer finds nothing to change. The reviewer template does not instruct the agent to use `--allow-empty` (it only calls `git add` + `git commit`), and the collector's second git log (`git log --name-status -- docs/specs/features docs/specs/research-topics`) filters by path, so empty commits would never appear in the pending-review scan even if produced. Either the template should gain an `--allow-empty` instruction AND the collector should add a path-free `--grep='^spec-review:'` pass, or the "no changes" AC should be dropped.
- **Test budget over ceiling**: `scripts/check-test-budget.sh` reports 2235 / 2000 LOC (net +95 on this branch). AC "Net test-suite LOC change ≤ 0" is violated. Needs user decision: delete older tests or grant a ceiling bump.
- **Regex id-capture is fragile for future format changes**: `parseSpecReviewSubject` in `lib/dashboard-status-collector.js` uses a non-greedy `.+?` with an optional em-dash/hyphen trailer. If the format ever flips to colon separator per AC, the captured id would include the decision summary. Not a live bug given the current template, but worth tightening once format is finalised.
- **Expected post-merge conflict with F277**: branch diverged before F277 (`harden-autonomous-loop-write-paths`) landed on main. F277 added `buildReviewCheckFeedbackPrompt` and a `resolvesSlashCommands` capability flag. This branch reintroduces the same behaviour inline in `lib/commands/feature.js` using a CMD_PREFIX regex shape-sniff. When this branch rebases on main, the F277 capability-flag path should win; the inlined regex should be removed in favour of `buildReviewCheckFeedbackPrompt`.

### Fixes Applied
- `fix(review): add REGRESSION comments to spec-review-status tests` — per CLAUDE.md T2, the three tests in `tests/integration/spec-review-status.test.js` now name the specific regression they prevent.

### Notes
- No code-level fixes for the findings above: every other finding is either a spec/implementation alignment decision (em-dash vs colon, empty-commit handling) or a merge-time concern (F277 rebase) that the author + user should settle before `feature-close`.
- Dashboard, CLI, and test behaviours were read-only validated against the spec's Validation commands and the status-collector test coverage; runtime smoke test was not performed.
