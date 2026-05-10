# Implementation Log: Feature 495 - agent-context-misidentifies-codex-as-cursor
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu  
**Date**: 2026-05-10

### Fixes Applied

- None — implementation was clean (two-pass ancestry + tokenized argv matching; regression tests align with acceptance criteria).

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- None

### Notes

- Approved: exact `commBase` pass before token pass removes the Codex→Cursor false positive from substring `agent` matching; deeper exact matches beat shallow fuzzy matches as required.
