# Implementation Log: Feature 301 - add-opencode-cli-coding-agent
Agent: cc

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-22

### Fixes Applied
- `fix(review): remove legacy agent-list drift from help surfaces`

### Residual Issues
- None

### Notes
- Replaced remaining user-facing `cc|gg|cx|cu` placeholders with generic `agent-id` wording so `op` is visible on install/help surfaces through the registry contract.
- Fixed the generalized inline-prompt launcher so non-slash `feature-spec-review` launches write a command-specific temp file instead of `feature-<id>-undefined.md`.
- Verified with `node tests/integration/opencode-agent-contract.test.js`.
