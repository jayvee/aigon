---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-24T00:36:03.948Z", actor: "cli/feature-prioritise" }
---

# Feature: Interactive Setup and Update Notifications

## Summary

F329 implemented a minimal `aigon global-setup` that asks one question (terminal app choice, macOS only) and falls back silently on Linux. F328 implemented an update-check module but surfaces notifications only when explicitly invoked via `aigon check-version`. This feature improves both: expanding `aigon global-setup` to ask useful questions on Linux (terminal preference, shell), and surfacing update notifications automatically at the end of every CLI command run — so users know there's a newer version without having to ask. Together these close the gap between the current bare-minimum first-run experience and the full TUI wizard planned in R39.

## User Stories

- As a Linux user running `aigon global-setup` for the first time, I want to be asked which terminal emulator I use — not silently skip the question as if Linux doesn't matter.
- As a user on any platform, I want to know when a newer version of Aigon is available without having to explicitly run `aigon check-version`.
- As a user who just installed Aigon and runs their first command, I want a clear "you're all set" confirmation with version and update status rather than silence.
- As a CI/script user, I want update notifications to be suppressed automatically when stdout is not a TTY, so they don't pollute script output.

## Acceptance Criteria

- [ ] `aigon global-setup` asks the Linux terminal question (gnome-terminal, kitty, xterm, or skip) when run interactively on Linux.
- [ ] `aigon global-setup` also asks for the user's preferred shell on Linux if `$SHELL` is not set.
- [ ] After any aigon CLI command that writes output to a TTY, a single-line update notice is appended if a newer version is available (using the cached result from `npm-update-check.js` — no extra network call on the hot path).
- [ ] The update notice is suppressed when stdout is not a TTY (`process.stdout.isTTY` is falsy).
- [ ] The update notice is suppressed if `AIGON_NO_UPDATE_NOTIFIER=1` is set in the environment.
- [ ] `aigon global-setup` prints a clear success summary on completion: version installed, terminal configured, update status.
- [ ] `node -c aigon-cli.js` and `npm test` pass.

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` if changes touch only `lib/commands/setup.js`, `lib/npm-update-check.js`, and `aigon-cli.js` with no dashboard assets changed.

## Technical Approach

### 1. Linux terminal question in `aigon global-setup`

In `lib/commands/setup.js`, the `global-setup` handler already gates the terminal question on `process.platform === 'darwin'`. Add an equivalent Linux block using the supported terminals from `lib/terminal-adapters.js` (`LINUX_TERMINALS`: kitty, gnome-terminal, xterm):

```
Which terminal do you use for agent sessions?
  1) GNOME Terminal
  2) Kitty
  3) xterm
  4) Skip (auto-detect)
```

Write the answer to `linuxTerminal` in the global config (the existing config key, already supported by `lib/config.js`).

### 2. Update notice on CLI command exit

In `aigon-cli.js` (the dispatch shim), after the command handler resolves, check `getCachedUpdateCheck()` from `lib/npm-update-check.js`. If a cached result exists and `formatUpdateNotice()` returns a non-null string, print it to stderr. Trigger a background async `checkForUpdate()` call on startup (fire-and-forget, no await) so the cache is warm for subsequent commands within the same session.

Since `aigon-cli.js` is a short dispatch shim, the change is small: one fire-and-forget call at the top, one notice print at the bottom.

### 3. Global-setup completion summary

At the end of `aigon global-setup` (interactive path), print:
```
✅ Aigon v2.54.5 configured
   Terminal: iTerm2
   Update: ✅ up to date  (or: ⬆️  v2.55.0 available — npm update -g @aigon/cli)
```

## Dependencies

- depends_on: publish-npm-package-1-package-structure-and-publishing (F326 — update check requires npm registry; already done)
- The full TUI wizard (R39 → future feature) supersedes this. This feature is an interim improvement that ships faster.

## Out of Scope

- Full step-by-step TUI wizard (that is R39 and its follow-on feature)
- Installing missing prerequisites or agent CLIs from within global-setup
- Windows support
- Gemini/Codex/Cursor equivalent setup flows

## Open Questions

- Should the update check fire-and-forget on every command, or only on "user-facing" commands (i.e. not internal plumbing commands like `session-hook`)? Probably exclude internal commands to avoid noise.

## Related

- F328: publish-npm-package-3-update-notifications-and-dashboard-status (implemented the check module)
- F329: publish-npm-package-4-interactive-global-setup (implemented the minimal wizard)
- R39: tui-onboarding-wizard-frameworks (full wizard — this feature is superseded by R39's output)
