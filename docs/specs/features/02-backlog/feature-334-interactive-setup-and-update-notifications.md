---
complexity: small
depends_on: feature-337-onboarding-wizard
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-24T00:36:03.948Z", actor: "cli/feature-prioritise" }
---

# Feature: Automatic Update Notifications

## Summary

F328 implemented an update-check module (`lib/npm-update-check.js`) but surfaces the result only when the user explicitly runs `aigon check-version`. This feature wires that module into the normal CLI command lifecycle: a fire-and-forget background check warms the cache on startup, and a single-line stderr notice is appended after any user-facing command when a newer version is available. No extra network round-trip on the hot path; no output when running non-interactively or in CI.

The Linux terminal and setup improvements originally scoped here are now covered by F336 (prereq detectors) and F337 (onboarding wizard).

## User Stories

- As a user on any platform, I want to know when a newer version of Aigon is available without having to explicitly run `aigon check-version`.
- As a CI/script user, I want update notifications to be suppressed automatically when stdout is not a TTY, so they don't pollute script output.

## Acceptance Criteria

- [ ] After any user-facing `aigon` CLI command that runs in a TTY, a single-line update notice is appended to `stderr` if a newer version is available (using the cached result from `lib/npm-update-check.js` — no extra network call on the hot path).
- [ ] A background async `checkForUpdate()` call is triggered at CLI startup (fire-and-forget, no await) to warm the cache for subsequent commands within the same session.
- [ ] The background network call must not prevent the Node.js process from exiting when the CLI command finishes (use `unref()` on any timer or child process).
- [ ] The update notice is suppressed for internal plumbing commands: `feature-spec-review-record`, `sync-heartbeat`, `session-hook`, and any command not intended for human-readable output.
- [ ] The update notice is suppressed when `process.stdout.isTTY` is falsy.
- [ ] The update notice is suppressed if `AIGON_NO_UPDATE_NOTIFIER=1` is set in the environment.
- [ ] `node -c aigon-cli.js` and `npm test` pass.

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` if changes touch only `lib/npm-update-check.js` and `aigon-cli.js` with no dashboard assets changed.

## Technical Approach

All changes are in `aigon-cli.js` (the dispatch shim):

1. **Startup** — after command dispatch is set up, fire `checkForUpdate()` from `lib/npm-update-check.js` without `await`. Call `.unref()` on any internal timer it starts so the process can exit cleanly.

2. **After handler resolves** — call `getCachedUpdateCheck()`. If it returns a non-null result and `formatUpdateNotice()` returns a non-empty string, write it to `process.stderr`.

3. **Suppression guard** — define a `PLUMBING_COMMANDS` set of internal command names. Skip both the background call and the notice print if the resolved command is in that set, `!process.stdout.isTTY`, or `process.env.AIGON_NO_UPDATE_NOTIFIER` is set.

Since `aigon-cli.js` is a ~90-line dispatch shim, the total diff is small: one guard block at the top, one notice block at the bottom.

## Dependencies

- depends_on: F328 (publish-npm-package-3-update-notifications — implemented `lib/npm-update-check.js`; already done)
- should_follow: F337 (onboarding-wizard — F337 registers `onboarding` and `setup` commands and modifies `aigon-cli.js` for the first-run gate; F334's `PLUMBING_COMMANDS` suppression list must include those commands, and doing both in sequence avoids conflicts in `aigon-cli.js`)

## Out of Scope

- Linux terminal preference question (covered by F337 onboarding wizard)
- Global-setup completion summary (covered by F337 onboarding wizard)
- Windows support
- Surfacing the update notice inside the onboarding wizard (F337 handles its own `outro()`)

## Related

- F328: publish-npm-package-3-update-notifications-and-dashboard-status (the check module this feature consumes)
- F336: onboarding-prereq-detectors
- F337: onboarding-wizard
- R39: tui-onboarding-wizard-frameworks (research that motivated the F336/F337 split)
