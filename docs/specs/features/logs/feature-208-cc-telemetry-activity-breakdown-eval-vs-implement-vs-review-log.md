# Implementation Log: Feature 208 - telemetry-activity-breakdown-eval-vs-implement-vs-review
Agent: cc

## Progress

- Added `activity` field to normalized telemetry record schema in `writeNormalizedTelemetryRecord`
- `captureSessionTelemetry` infers activity from branch name: `/eval/` → evaluate, `/review/` → review, else implement. Also reads `AIGON_ACTIVITY` env var.
- Added `activity: 'implement'` to Cursor no-telemetry, Gemini transcript, Codex transcript, and fallback session records
- Changed `collectCost` byAgent key from `agentId` to `agentId:activity` so same agent doing implement vs evaluate gets separate rows
- Updated Stats tab to render activity label next to agent name (e.g. `CC · claude-opus-4-6 · implement · ...`)

## Decisions

- Used `agentId:activity` composite key in `collectCost` byAgent map so the dashboard naturally shows separate rows per agent+activity combination
- Activity inference in `captureSessionTelemetry` uses word-boundary regex (`\beval\b`, `\breview\b`) to avoid false matches on branch names
- Gemini/Codex/Cursor records get activity via options passthrough, defaulting to `'implement'` since `captureAgentTelemetry` is only called for implementers

## Code Review

**Reviewed by**: cx  
**Date**: 2026-04-02

### Findings
- `writeNormalizedTelemetryRecord` stored `activity` as `null` when omitted, which missed the spec default-to-`implement` requirement.
- `captureSessionTelemetry` inferred activity from `getCurrentBranch()` without using `AIGON_PROJECT_PATH`, so SessionEnd hooks running outside the worktree could classify the branch incorrectly.

### Fixes Applied
- `61185443` — `fix(review): default telemetry activity and read worktree branch`

### Notes
- Review stayed scoped to the spec: one targeted telemetry fix, no broader refactor.
