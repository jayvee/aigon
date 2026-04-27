# Implementation Log: Feature 408 - linked-context-agent-awareness
Agent: cc

Wired RESEARCH_CONTEXT_SECTION placeholder + research-aware steps into feature-do, feature-code-review, and feature-spec-review templates; new helper `buildResearchContextSection` resolves research spec + findings paths from `research:` frontmatter.

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: Cursor (composer)
**Date**: 2026-04-27

### Fixes Applied
- `fix(review): remove dead ternary in buildResearchContextSection` — both branches of the research-ID heading were identical; collapsed to a single push.

### Residual Issues
- **Unrelated spec on branch**: `docs/specs/features/02-backlog/feature-407-competitive-scan-2026-04.md` is added in the same diff as F408. If this branch is meant to be F408-only, drop or move that file; if it is an intentional stacked change, note it in the PR description.
- **Spec vs tests**: The spec Technical Approach suggested using on-disk R44 paths in tests; the integration test uses an isolated temp fixture instead. Behaviour matches acceptance criteria and keeps CI hermetic — optional doc tweak only.

### Notes
- `readResearchTag` + `parseFrontMatter` already normalise scalar `research: 44` to an array, so linked research IDs resolve correctly for real specs (e.g. F399–F402).
- Template updates for `feature-code-review` / `feature-spec-review` align with the feature goals; bash steps mirror the existing research-context pattern.

