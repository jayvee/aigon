# Implementation Log: Feature 334 - interactive-setup-and-update-notifications
Agent: cc

## Status

Implemented in `aigon-cli.js` + minimal `lib/npm-update-check.js` addition: background fire-and-forget `checkForUpdate({ unref: true })` at startup; post-command `getCachedUpdateCheck()` notice to stderr; suppressed for PLUMBING_COMMANDS, non-TTY, and AIGON_NO_UPDATE_NOTIFIER.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
