---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-24T00:34:37.225Z", actor: "cli/feature-prioritise" }
---

# Feature: robust-hook-binary-resolution

## Summary

When `aigon install-agent` writes hook commands into the agent config files it owns, it currently resolves the `aigon` binary path at install time using a hardcoded list of candidate locations (`/opt/homebrew/bin/aigon`, `/usr/local/bin/aigon`, `/usr/bin/aigon`). This is brittle: it fails in corporate environments, custom install prefixes, nvm/fnm setups, and any location not on the hardcoded list. The fix is to wrap hook commands in the user's login shell (`$SHELL -l -c "..."`), which sources the user's shell profile at hook runtime and resolves `aigon` correctly regardless of where it is installed.

## Background & Research

### The problem in detail

Agent hooks fire in a subprocess spawned by the agent CLI (Claude Code, Gemini, etc.). That subprocess may have a severely restricted PATH — in particular, when Claude Code is launched from the macOS Dock, Spotlight, or Launchpad, it receives only the system default PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). Homebrew (`/opt/homebrew/bin`), nvm, fnm, and npm global install paths are all absent.

This means:

- **Bare `aigon`** — fails when PATH doesn't include the install location (Dock launch, GUI apps on macOS).
- **`env aigon`** — same failure; `env` searches the inherited PATH, which is the same minimal PATH.
- **`which aigon` at install time** — resolves correctly for the current shell session, but fnm creates ephemeral symlinks at `~/.local/state/fnm_multishells/<shell-id>/bin/aigon` that become stale the moment that shell exits. Hooks then fire against a dead path.
- **Hardcoded candidates** (`/opt/homebrew/bin/aigon`, `/usr/local/bin/aigon`, `/usr/bin/aigon`) — covers the most common cases but fails for: Linux with nvm (`~/.nvm/versions/node/.../bin/aigon`), Volta (`~/.volta/bin/aigon`), corporate custom prefixes, any non-standard install path.

### Research findings

**Claude Code hook execution environment** (source: Claude Code docs, GitHub issue #44649):
Hooks execute in Bash by default and inherit Claude Code's environment. When Claude Code is launched from the macOS GUI (Dock/Spotlight/Launchpad), it does **not** inherit the user's shell PATH. Only system defaults are present. This is a documented known issue. `env aigon` and bare `aigon` are therefore not reliable.

**Husky (npm git hooks manager)** wraps all hook commands in the user's login shell: `$SHELL --login -c "..."`. A login shell sources `/etc/profile`, `~/.bash_profile`, `~/.zprofile`, etc., which is exactly where Homebrew, nvm, fnm, Volta, and npm globals inject themselves into PATH. This works regardless of whether the parent process was a GUI app or a terminal. Husky is used in tens of thousands of projects and this approach is battle-tested.

**`$SHELL -l -c "command"`** (login shell invocation):
- Sources shell profile files on every invocation (no TTY required)
- Works from GUI app subprocesses
- Resolves at hook runtime, not install time — no staleness problem
- Works with any install location that the user's shell profile knows about
- On macOS (default shell: zsh since Catalina), `$SHELL` = `/bin/zsh`; login shell sources `~/.zprofile` and `~/.zshrc`
- On Linux, `$SHELL` = `/bin/bash` typically; login shell sources `/etc/profile`, `~/.bash_profile`, `~/.bashrc`

**Known failure case**: if the user's shell profile itself has errors (syntax errors, commands that exit non-zero), the login shell may fail before PATH is populated. This is an edge case that affects any approach that relies on shell profiles — including nvm, Homebrew, and Volta themselves.

**Corporate / custom prefix installs**: any installation that modifies the user's shell profile (which all standard package managers do) will be found by the login shell approach. Only fully off-grid installs that modify PATH only in ephemeral environments (e.g. a CI-only path injection) would be missed — and those environments typically don't use GUI-launched agent CLIs anyway.

### Sources
- Claude Code hooks documentation: https://code.claude.com/docs/en/hooks
- Claude Code GUI PATH issue: https://github.com/anthropics/claude-code/issues/44649
- Husky hook wrapper approach: https://github.com/typicode/husky

## User Stories

- As a developer on macOS who launches Claude Code from the Dock, I want Aigon hooks to fire correctly without any manual PATH configuration.
- As a developer using nvm or fnm to manage Node versions, I want Aigon hooks to find the correct aigon binary even after my shell session changes.
- As a developer in a corporate environment with a non-standard install prefix, I want Aigon hooks to work as long as aigon is in my shell PATH.
- As a Linux user who installed aigon via nvm (not sudo npm -g), I want hooks to resolve aigon from my nvm-managed PATH.

## Acceptance Criteria

- [ ] Hook commands written by `install-agent` use `${process.env.SHELL || '/bin/bash'} -l -c "aigon ..."` (or equivalent shell-quoted form) rather than hardcoded absolute paths or bare `aigon`. This applies to **both** the settings-backed hook path (Claude/Gemini, around `lib/commands/setup.js:1250`) and the standalone hooks-file path (Cursor, around `lib/commands/setup.js:1366`).
- [ ] The shell binary is resolved at install time from `process.env.SHELL`, with `/bin/bash` as fallback.
- [ ] The wrapped form preserves any `$VAR` or `$CLAUDE_PROJECT_DIR`-style shell expansions in the original command (i.e. inner content is wrapped in double quotes, not single quotes; embedded double quotes inside the inner command, if any exist, are escaped).
- [ ] Re-running `install-agent` on an existing install migrates existing Aigon hook commands in place to the new format without duplicating entries or rewriting unrelated (non-Aigon) hooks. Migration is idempotent: a hook already in the wrapped `$SHELL -l -c "aigon ..."` form is left unchanged on subsequent runs.
- [ ] Migration rewrites all known stale forms: bare `aigon ...`, absolute path `/opt/homebrew/bin/aigon ...` (and other `^/.+/aigon` forms), and stale `~/.local/state/fnm_multishells/.../aigon` paths. Non-Aigon hook entries remain byte-for-byte identical.
- [ ] Hooks remain correct when Claude Code is launched from the macOS Dock (minimal PATH environment) and when aigon is installed via nvm, fnm, Homebrew, or `npm -g`. (Verified manually on macOS Dock launch; documented in the implementation commit message.)
- [ ] The hardcoded candidate path list (`/opt/homebrew/bin/aigon`, `/usr/local/bin/aigon`, `/usr/bin/aigon`) and install-time `which aigon` resolution are removed from **every** hook-writing path in `lib/commands/setup.js` (currently lines ~1261–1305 and ~1397–1408).
- [ ] The test suite includes regression tests covering: (a) fresh install writes the wrapped form for both settings-based and standalone-file hook paths, (b) migration of a hook with a hardcoded absolute path to the wrapped form, (c) migration of a stale fnm-multishells path, (d) idempotent re-run leaves an already-wrapped hook unchanged, (e) a non-Aigon hook entry sharing the same event is left untouched.
- [ ] `node -c aigon-cli.js` and `npm test` pass.

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` if changes touch only `lib/commands/setup.js` and no dashboard assets.

## Technical Approach

### Change hook command format

In `lib/commands/setup.js`, two sections currently build `aigonAbsPath` from a hardcoded candidate list and write the resolved absolute path into hook commands:

1. Settings-backed hooks for Claude/Gemini — around lines 1261–1305 (and the per-hook resolution at lines 1330, 1342, 1346).
2. Standalone hooks file for Cursor — around lines 1397–1411.

Replace both with a single resolved-at-install-time shell wrapper:

```js
// Before (brittle):
const stableCandidates = [
    '/opt/homebrew/bin/aigon',
    '/usr/local/bin/aigon',
    '/usr/bin/aigon',
];
// ... falls through to `which aigon`, then writes the absolute path into the hook command

// After (robust):
const userShell = process.env.SHELL || '/bin/bash';
// Hook commands become: `/bin/zsh -l -c "aigon session-hook --repo ..."`
```

When writing each hook's `command` field, wrap it with the resolved shell. Inner content must use **double quotes** so that `$CLAUDE_PROJECT_DIR` and other shell variables in existing hook templates continue to expand at runtime; if the inner command itself contains `"`, escape it as `\"`:

```js
// Instead of: `${aigonAbsPath} session-hook --repo "$CLAUDE_PROJECT_DIR"`
// Write:       `${userShell} -l -c "aigon session-hook --repo \"$CLAUDE_PROJECT_DIR\""`
```

A small helper (`wrapAigonCommand(rawCmd)`) used by both sections will keep the wrapping consistent.

### Migration of existing hooks

The existing migration path (around lines 1281–1305) currently rewrites bare `aigon ...` and stale `^/.+/aigon ...` to a new absolute path. Replace it so it rewrites all known stale forms — bare `aigon `, hardcoded absolute path `^/.+/aigon `, and `fnm_multishells/.../aigon ` — to the wrapped `$SHELL -l -c "aigon ..."` form.

Migration must be:
- **Idempotent**: a command already starting with `${userShell} -l -c "aigon ` (or any `*sh -l -c "aigon `) is left unchanged.
- **Scoped**: any non-Aigon hook entry (`existing.command` that does not contain `aigon`) is byte-for-byte preserved.

The same migration logic must run for the Cursor standalone-hooks-file path (currently no migration block exists there — it must be added).

### Scope of changes

- `lib/commands/setup.js` — hook command generation and migration logic in both hook-writing blocks
- New test cases under the existing test suite covering the cases listed in Acceptance Criteria
- No changes to templates, dashboard, or workflow engine

## Dependencies

- None

## Out of Scope

- Solving agent CLI startup PATH problems outside the hook command strings written by `install-agent`
- Solving the case where the user's shell profile has errors (this is a user environment problem, not solvable at the tool level)
- Windows support

## Open Questions

- ~~Should we emit a warning during `install-agent` if `aigon` is not findable in a login shell invocation?~~ **Resolved: defer.** Spawning a login shell at install time adds noticeable latency for every `install-agent` run, and the failure mode (hook fires, user sees a "command not found" once) is loud enough on its own. Revisit only if real-world reports show silent hook failures.

## Related

- Discovered during: Linux Docker install testing of F326–F331 (publish-npm-package feature set)
