# Feature: radar-auto-trigger-eval

## Summary

When the AIGON server detects that all Fleet agents have submitted for a feature, it should automatically launch `aigon feature-eval <ID>` in a new tmux session. Currently radar sends a macOS notification but the user must manually run the eval command. This closes the loop on fully autonomous Fleet execution.

## User Stories

- [x] As a developer, I want radar to automatically start evaluation when all agents submit, so I don't have to watch for notifications and manually trigger eval
- [x] As a developer, I want to see in the menubar that an auto-triggered eval is running

## Acceptance Criteria

- [x] When radar polls and detects all agents submitted for a feature, it spawns `aigon feature-eval <ID>` in a detached tmux session
- [x] Auto-eval only triggers once per feature (not on every poll cycle)
- [x] The menubar shows the feature has moved to "in-evaluation" stage
- [x] A macOS notification is sent when auto-eval is triggered
- [x] Auto-eval can be disabled via config (`autoEval: false` in global config)
- [x] If the eval tmux session already exists, radar does not spawn a duplicate

## Technical Approach

Extend the `pollStatus()` function in `runRadarServiceDaemon()` to detect the all-submitted transition and call `createDetachedTmuxSession()` with the eval command. Use a Set (like `allSubmittedNotified`) to track which features have already had eval triggered.

## Dependencies

- AIGON server (already exists)

## Out of Scope

- Auto-triggering feature-close after eval
- Multi-machine / remote radar
- Auto-eval for research (synthesize)

## Related

- Supersedes: feature-conduct-daemon-integration (deleted)
