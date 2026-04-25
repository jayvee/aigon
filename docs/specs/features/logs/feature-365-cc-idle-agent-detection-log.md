# Implementation Log: Feature 365 - idle-agent-detection
Agent: cc

## Status
Implemented: agent JSON `idleDetection` blocks for cc/gg (+ comment placeholders for cx/cu); supervisor `captureAndDetectIdle` + per-agent regex cache + idleAtPromptData map; dashboard collector exposes `idleAtPrompt`/`anyIdleAtPrompt`; `awaiting-input` class extended to OR `anyIdleAtPrompt` on feature/research cards.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
