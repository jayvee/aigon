---
commit_count: 3
lines_added: 258
lines_removed: 107
lines_changed: 365
files_touched: 9
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 92
output_tokens: 31230
cache_creation_input_tokens: 107910
cache_read_input_tokens: 3311925
thinking_tokens: 0
total_tokens: 3451157
billable_tokens: 31322
cost_usd: 1.867
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 336 - onboarding-prereq-detectors
Agent: cc

## Status
Completed

## New API Surface
- `lib/onboarding/detectors.js` exports `getDetectors` and `getAgentDetectors`.
- `detector` interface introduced: `{ id, label, required, async check(), async install(), async verify() }`.
- `runPrerequisiteChecks` in `lib/prerequisite-checks.js` is now `async`.
- Added `installCommand` property to agent JSON templates.

## Key Decisions
- Extracted detector logic from the check orchestrator into `lib/onboarding/detectors.js` to ensure the orchestrator remains clean as new dependencies are added.
- Defined a consistent interface for detectors that provides checking, installing, and verifying capabilities.
- Dynamically mapped over `agentRegistry.getAllAgents()` to centralize agent CLI lookups and properly align with the rest of the application's patterns.

## Gotchas / Known Issues
- `runPrerequisiteChecks` is now async, meaning call sites (like in `lib/commands/setup.js`) must use `await`.

## Explicitly Deferred
- The actual implementation of the install routines (invoking `install()` for missing dependencies automatically) is deferred to a future PR or feature; this PR focuses on providing the structure and the detectors.

## For the Next Feature in This Set
- Implement the automatic execution of the `install()` functions for missing prerequisites during the onboarding setup flow.

## Test Coverage
- Existing test suite passed successfully. All CLI commands were updated to correctly `await` the new async prerequisite checks.
