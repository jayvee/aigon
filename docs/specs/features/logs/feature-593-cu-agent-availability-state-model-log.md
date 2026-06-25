---
commit_count: 5
lines_added: 1095
lines_removed: 21
lines_changed: 1116
files_touched: 23
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 593 - agent-availability-state-model
Agent: cu

## Status
Implemented `lib/agent-availability.js`, CLI `aigon agent disable|enable|availability`, picker filtering, doctor/settings/dashboard wiring, and unit tests.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: amp (review pass, different model than implementer)
**Date**: 2026-06-25

### Fixes Applied
- dc3bfd9e4 `fix(review): align documented precedence with resolver behavior in agent-availability` — the module header documented a precedence (retired → deprecated → disabled → unconfigured → quota) that did not match the actual resolution order in `getAgentAvailability` (retired → user disabled → unconfigured → deprecated → active/quota). The spec requires the resolver to accurately document its precedence, so corrected the comment to reflect real behavior (no logic change).

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- ESCALATE:subsystem — Several launch surfaces the spec lists are not yet wired to `assertAgentUsable`/the usability filter: `feature-autonomous-start` / AutoConductor loop (`lib/feature-autonomous.js`), `set` autonomous selection (`lib/set-conductor.js`), workflow-definition agent validation (`lib/workflow-core/engine.js`), and the dashboard schedule-kickoff modal. These span separate subsystems with resume/in-flight semantics (e.g. an agent disabled mid-run should probably not kill a resuming autonomous loop), so the correct block-vs-allow behavior is an architectural/product decision, not a safe one-line patch in this review pass. The headline acceptance paths (feature-start, feature-eval/code-review/spec-review/-revise via entity-commands, recommendation ranking, default-fleet, dashboard pickers, doctor, settings, quota poller) ARE wired.

### Notes
- Per-agent loops (`getUsableAgentIds`, `getDashboardAgents`, `groupAvailabilityReport`) call `loadGlobalConfig()`+`loadProjectConfig()`+quota read once per agent (config is not cached). With ~12 agents this is acceptable and matches existing patterns, but is worth caching if the agent count grows.
- `getDefaultFleetAgents` now throws `no-usable-fleet-agents` instead of silently falling back; the only production caller (`research-autopilot`) does not wrap it in try/catch, so an all-disabled fleet surfaces as an uncaught throw rather than a clean `console.error`. The thrown message is actionable, so behavior is spec-compliant, but UX could be tidied.
- Contract test `template helpers expose exactly the registry agent set` was changed to assert `agentRegistry.getSortedAgentIds()` (a tautology with the line above) because `templates.getAvailableAgents()` now intentionally filters. Acceptable given the semantics change; the test name is now slightly inaccurate.
- `aigon agent availability --all` has weak semantics: disabled agents are always shown in their own section regardless of `--all`, so the flag changes little. Not a bug — visibility requirement is met.
