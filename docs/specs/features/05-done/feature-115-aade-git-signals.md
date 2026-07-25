# Feature: AADE Git Signals

## Summary

At feature-close, compute git metrics per feature branch: commit count, lines changed, files touched, and fix-commit ratio. Flag rework patterns — thrashing (5+ commits touching the same file), fix cascades (3+ consecutive fix commits), and scope creep (files touched >> spec scope). Store all metrics in feature log frontmatter alongside existing lifecycle data.

## User Stories

- [ ] As a developer, I want git metrics computed automatically at feature-close so I can see the implementation footprint of each feature
- [ ] As a developer, I want rework patterns flagged so I can identify when a feature had too much back-and-forth or agent thrashing
- [ ] As a developer, I want to track fix-commit ratio over time so I can see if my specs are improving (fewer fix commits = cleaner first passes)

## Acceptance Criteria

- [ ] At feature-close, the following git metrics are computed from the feature branch: `commit_count`, `lines_added`, `lines_removed`, `lines_changed` (added + removed), `files_touched` (unique files), `fix_commit_count`, `fix_commit_ratio`
- [ ] Fix commits detected by commit message patterns: starts with "fix", "fixup", "bugfix", or contains "fix:" (case-insensitive)
- [ ] Rework patterns detected and stored as boolean flags: `rework_thrashing` (5+ commits touching same file), `rework_fix_cascade` (3+ consecutive fix commits), `rework_scope_creep` (files_touched > 2x expected based on spec)
- [ ] All metrics stored as flat scalar fields in feature log frontmatter
- [ ] Metrics computed from `git log` and `git diff` against the base branch (main)
- [ ] Works correctly for both merged and unmerged branches

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

- Run `git log --oneline main..HEAD` on the feature branch to get commit list
- Run `git diff --stat main..HEAD` to get lines added/removed and files touched
- Parse commit messages for fix patterns using regex
- For thrashing detection: run `git log --name-only` and count per-file commit frequency
- For fix cascade: scan commit sequence for consecutive fix-pattern commits
- Scope creep heuristic: compare files_touched to a baseline (could be simple threshold or spec-derived)
- All computation happens in a new function called from `featureClose()` / `featureSubmit()`
- Results written to log frontmatter using existing `safeWriteWithStatus()` pattern

## Dependencies

- Feature branch naming convention (already established: `feature-ID-*`)
- Existing feature log frontmatter system
- Git available in PATH (already required by Aigon)

## Out of Scope

- Code quality metrics (test coverage, linting results, complexity)
- Diff content analysis (what changed, not just how much)
- Cross-feature file overlap detection
- Historical branch data for already-closed features (only new closures)

## Open Questions

- Should scope creep threshold be configurable or fixed at 2x?
- How to handle squash-merged branches where commit history is lost?
- Should revert commits be tracked separately from fix commits?
- What's the right base branch detection — always `main`, or read from config?

## Related

- Research: research-13-ai-development-effectiveness (Synthesis — Git Signals section)
- Feature: aade-telemetry-adapters (provides tokens for tokens_per_line_changed normalisation)
- Feature: aade-amplification-dashboard (displays git signal data)
