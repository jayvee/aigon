# Implementation Log: Feature 634 - be-arch-6-telemetry-provider-registry
Agent: cu

## Status
Split `lib/telemetry.js` into `lib/telemetry/` package (core, pricing, sqlite, capture, providers/cc|gg|ag|cx|op + registry); lazy facade preserves module-graph cycle count; session-sidecar path resolution unchanged.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
