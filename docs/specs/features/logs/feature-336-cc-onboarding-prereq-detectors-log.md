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
