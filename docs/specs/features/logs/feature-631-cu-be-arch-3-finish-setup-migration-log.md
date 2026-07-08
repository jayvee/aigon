# Implementation Log: Feature 631 - be-arch-3-finish-setup-migration
Agent: cu

## Status
Deleted setup-legacy.js (5,454 LOC); all setup commands now live in lib/commands/setup/*.js with shared helpers split to init-bootstrap, seed-registry, seed-entity-ids. Fan-out: monolith 79 → max per-module ~48 (doctor); install-agent 23, apply ~18.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
