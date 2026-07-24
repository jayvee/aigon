---
commit_count: 4
lines_added: 432
lines_removed: 312
lines_changed: 744
files_touched: 99
fix_commit_count: 2
fix_commit_ratio: 0.5
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
---

# Implementation Log: Feature 696 - restore-antigravity-agent-reliability

## Status

Implemented; waiting for user review before feature close.

## New API Surface

## Key Decisions

- Re-enabled `ag` only after a live macOS TTY smoke on `agy 1.1.7`: a fresh process
  restored its Keychain OAuth token, received its initial prompt, created
  `AGY_LIVE_SMOKE.md`, and returned `DONE` without a browser sign-in.
- Kept the provider boundary explicit. Antigravity remains an interactive OAuth/keyring
  agent only: Doctor never starts `agy`, and no `ANTIGRAVITY_TOKEN`/`AGY_TOKEN` value is
  treated as proof of authentication.
- Updated Aigon's model slugs to the installed CLI's tiered values. The former
  `gemini-3.5-flash` launch value fails because 1.1.7 requires an explicit tier;
  `gemini-3.5-flash-medium` succeeds.
- Replaced the retired Gemini-style hook schema with Antigravity's named-hook schema
  (`PreInvocation`, `PostInvocation`, `Stop`) and second-based timeouts.

## Gotchas / Known Issues

- `agy` logs transient "not logged in" cache lookups before it reads the macOS Keychain;
  the same process then authenticates successfully. Do not use that early diagnostic as
  an auth result.
- Headless/container credential persistence is still blocked upstream (#479), and API-key
  authentication remains unsupported (#78). Those paths are deliberately not supported
  by Aigon.

## Explicitly Deferred

- Headless/container Antigravity authentication and API-key support remain upstream work;
  Aigon intentionally does not offer either path.

## For the Next Feature in This Set

## Test Coverage

- Live: `agy --version` reported `1.1.7`; `agy --help` confirmed
  `--prompt-interactive`, `--model`, and `--dangerously-skip-permissions`; fresh print
  probes returned `PONG`; a trusted tmux TTY smoke created the requested file and
  returned `DONE`.
- Install: `aigon install-agent ag` passed in an isolated Git repo and `agy plugin install`
  accepted the staged plugin. Reinstalling the local plugin succeeded after the hook fix.
- Automated: `node tests/integration/doctor-agent-auth-probe.test.js`,
  `node tests/integration/quota-probe.test.js`, and `npm run test:iterate` all passed.

## Documentation Follow-up

- Replaced live `gg`/Gemini CLI examples across public site content, LLM metadata,
  README, clean-room guidance, and installed command templates with the supported `ag` /
  Antigravity CLI path. Historical specs, telemetry, and archived review material remain
  unchanged.
- Corrected the associated operational facts: `agy` command and permission flag,
  file-prompt delivery, plugin hooks, SQLite conversation telemetry, current model slugs,
  and the no-automatic-Antigravity-quota-polling rule.
