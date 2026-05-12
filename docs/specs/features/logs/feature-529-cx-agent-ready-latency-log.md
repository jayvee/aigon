# Implementation Log: Feature 529 - agent-ready-latency
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cursor-composer
**Date**: 2026-05-12

### Fixes Applied
- `1a24e9b7` — `fix(review): restore feature-530 spec; surface agents_active startup phase` — Restored `docs/specs/features/02-backlog/feature-530-auto-review-implementor-confirm-after-reviewer-changes.md` (out-of-scope deletion vs `main`). Extended `startupPhase` in `lib/dashboard-status-collector.js` so `agents_active` from `computeStartupReadiness` reaches the card pipeline (matches `templates/dashboard/js/pipeline.js` allow-list).

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- **ESCALATE:subsystem** — Research kanban rows still omit `startupReadiness` / `startupPhase` in `collectResearch`; feature cards only. Acceptable if product scope is features/fleets; extend later if research fleets need the same UX.

### Notes
- Core implementation (`computeStartupReadiness`, earlier heartbeat + status in `buildAgentCommand`, detail tab intervals, integration test) looks coherent with the spec’s read-side / non-engine constraint.
- Acceptance criterion “A new Brewboard measurement is captured after the change” is not evidenced in-repo; operator/implementer should capture a before/after trace on Brewboard before close if that AC is strict.
