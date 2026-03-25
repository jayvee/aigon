# Feature: agent-scope-guard

## Summary

Add scope guardrails to agent prompts and the feature-submit workflow to prevent agents from deleting or modifying code outside the scope of their assigned feature. This addresses a recurring pattern where agents (particularly cx/Codex) delete completed features' code, move spec files backwards, and remove tests — causing regressions that require extensive review cleanup.

## Motivation

During the feature-145 review, the cx agent deleted code from 6 completed features (135, 144, 146, 147, 148, 149) while implementing a single new feature. It removed the Mistral Vibe agent, dependency system, SAST scanning, git attribution, session telemetry, and dashboard components — all shipped work. Three of the deleted features (135, 146, 147) were built by the same cx agent in earlier sessions.

This is not a one-off: agents operating without scope constraints treat the codebase as a canvas to reshape rather than a foundation to build on. The review caught it, but the cleanup took longer than the original implementation. Prevention is better than cure.

## User Stories
- [ ] As a user, I want agents to only modify files relevant to their assigned feature
- [ ] As a user, I want feature-submit to warn me if the diff includes suspicious deletions
- [ ] As a user, I want the review step to have a clear scope baseline to compare against
- [ ] As a user, I want agent-specific constraints for agents known to over-delete (cx)

## Acceptance Criteria

### Prompt-level guards
- [ ] Feature-do agent prompt (templates) includes explicit scope constraint: "Do not delete, move, or modify files unrelated to your feature spec. If existing code conflicts, document it in your log — do not remove it."
- [ ] Feature-do prompt includes: "Do not delete any test files. Do not remove existing function exports."
- [ ] The cx/Codex-specific agent doc (`docs/agents/codex.md`) includes a stronger additive-only constraint
- [ ] Feature-do prompt includes: "Do not move spec files between folders — only the CLI manages spec state transitions."

### Submit-time scope check
- [ ] `feature-submit` records a file snapshot at `feature-start` time (list of tracked files in the worktree, stored in manifest or `.aigon/state/`)
- [ ] At submit time, `feature-submit` compares the current diff against the snapshot and flags:
  - Files deleted that existed at start time (warning, not blocking)
  - Test files deleted (`.test.js`, `.test.ts`, `*.spec.*`) — strong warning
  - Spec files moved between kanban folders — error, blocked
  - More than 20 files changed — info-level "large changeset" notice
- [ ] Scope warnings are printed to the terminal and recorded in the implementation log
- [ ] A `--force` flag allows bypassing warnings (but not spec-move errors)

### Review integration
- [ ] The feature-review prompt references the scope snapshot so the reviewer knows what the baseline was
- [ ] Review prompt explicitly instructs: "Check for out-of-scope deletions before reviewing correctness"

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### File snapshot at start
- In `entityStart()` (lib/entity.js), after worktree creation, run `git ls-files` and store the result in `.aigon/state/feature-{id}-file-snapshot.txt`
- This is cheap (~1ms for repos under 10K files) and gives a perfect baseline

### Scope check at submit
- In `feature-submit` (lib/commands/feature.js), load the snapshot and compare against `git diff --name-status main...HEAD`
- Classify each change as: added (always OK), modified (OK), deleted (check against snapshot), renamed (check source existed in snapshot)
- Print a summary table of scope warnings

### Prompt updates
- Edit `templates/generic/commands/feature-do.md` to add the scope constraints
- Edit `docs/agents/codex.md` (or equivalent cx agent doc) for cx-specific constraints
- Edit `templates/generic/commands/feature-review.md` to reference scope checking

## Dependencies
- None

## Out of Scope
- Blocking submit on scope violations (start with warnings, escalate later based on data)
- Per-file ownership / CODEOWNERS integration
- Auto-reverting out-of-scope changes (too risky — let the human decide)

## Open Questions
- Should the scope check run at submit time, or also at each commit within the worktree?
- Should we track scope violations as a metric in the dashboard (e.g., "scope creep score" per agent)?

## Related
- Feature 145 review: the incident that motivated this feature
- Feature 135, 144, 146, 147, 148, 149: features that were deleted by scope creep
