# Implementation Log: Feature 502 - template-install-drift-guard
Agent: cc

Three drift layers (L1 startup warning + L2 silent version-bump reinstall + L3 lockstep CI test) plus `aigon doctor --fix-templates` and a `prepublishOnly` lockstep guard; manifest schema gains `agents`, `agentInstalls`, and per-entry `templateSha` for content-based detection.

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
