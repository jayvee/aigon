---
commit_count: 9
lines_added: 105
lines_removed: 51
lines_changed: 156
files_touched: 14
fix_commit_count: 5
fix_commit_ratio: 0.556
rework_thrashing: false
rework_fix_cascade: true
rework_scope_creep: false
---

# Implementation Log: Feature 265 - fix-stale-command-references-in-docs-and-landing-page

## Plan

Pure find-and-replace across known files. No code logic changes.

## Progress

- Fixed `templates/docs/development_workflow.md` and `docs/development_workflow.md`: replaced `feature-implement` -> `feature-do`, `feature-done` -> `feature-close`
- Fixed `templates/generic/skill.md`: replaced `feature-implement` -> `feature-do`, `feature-done` -> `feature-close`, `research-conduct` -> `research-do`, `research-done` -> `research-close`
- Fixed `site/public/home.html`: replaced `feature-autopilot` -> `feature-do --iterate`, `feature-setup` -> `feature-start`, `worktree-open` -> `feature-open`, removed `--auto-submit` flag
- Fixed `docs/agents/{claude,gemini,codex,cursor}.md`: replaced `aigon research-spec` with direct path instruction
- Fixed `templates/generic/docs/agent.md` and `templates/generic/commands/research-review.md`: same research-spec fix

## Decisions

- Used `aigon feature-do 07 --iterate` as replacement for `aigon feature-autopilot 07` in landing page demos (iterate is the current name for the retry loop)
- Replaced `aigon research-spec <ID>` with "read from `docs/specs/research-topics/03-in-progress/`" since no research-spec command exists and adding one is out of scope

## Code Review

**Reviewed by**: cc
**Date**: 2026-04-16

### Findings
- `docs/development_workflow.md` and `templates/docs/development_workflow.md` still referenced `feature-done` in the workflow prose even after the headline table was updated.
- `site/public/home.html` still contained `feature-setup` strings in the landing-page demos, so the public page continued to show stale commands.

### Fixes Applied
- Updated the remaining `feature-done` references to `feature-close` in both workflow docs.
- Updated the remaining `feature-setup` demos in `site/public/home.html` to `feature-start`.

### Notes
- The feature is still a pure docs/template/landing-page cleanup; no CLI behavior changed.
