# Implementation Log: Feature 299 - rename-feature-review-to-feature-code-review
Agent: cc

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-21

### Fixes Applied
- `3101b6dd` — `fix(review): rename review command in cleanup and help surfaces`

### Residual Issues
- None

### Notes
- Updated `sessions-close` process matching so `feature-reset` and related cleanup paths also kill review sessions launched under the new canonical `feature-code-review` name.
- Updated the shipped help and agent-facing command tables so install/docs surfaces no longer present the deprecated `feature-review` name as canonical.
