---
complexity: medium
research: 46
set: deepen-create
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T23:21:51.440Z", actor: "cli/feature-prioritise" }
---

# Feature: deepen-create-3-toggle-and-quick-flag

## Summary

Wire up the on/off control surface for the deepen interview behavior introduced in features #1 and #2. Default-on is the goal: thin specs are the current default failure mode and an opt-in flag wouldn't be typed by the people who need it most. Add a `--quick` per-call flag to skip the interview, and a `deepen.enabled` config key (project + user precedence) so users who genuinely prefer one-shot creation can disable it once and forget about it.

This is the smallest piece of code/config work in the set — feature #1 and #2 ship the behavior, this feature ships the control over when the behavior runs.

## User Stories

- [ ] As a user, the default behavior of `aigon feature-create` and `aigon research-create` runs the deepen interview, because the default should be the higher-quality path.
- [ ] As a user in a hurry, I pass `--quick` to skip the interview for one call and get today's one-shot scaffolding behavior.
- [ ] As a user who genuinely prefers one-shot creation, I run `aigon config set deepen.enabled false` once and the deepen flow stops running everywhere unless I flip it back.
- [ ] As a project lead, I commit `deepen.enabled: false` (or `true`) in `.aigon/config.json` so my team's default matches our preference, with the user-level config falling through.
- [ ] As a user invoking `aigon feature-create --quick`, no deepen prompt is loaded and no interview is attempted regardless of config.

## Acceptance Criteria

- [ ] `aigon feature-create` and `aigon research-create` both accept `--quick` and skip the deepen block entirely when present.
- [ ] `deepen.enabled` is a recognised config key with precedence: per-call `--quick` flag (skip) > project `.aigon/config.json` > user `~/.aigon/config.json` > built-in default `true`.
- [ ] `aigon config show` displays `deepen.enabled` and its effective value.
- [ ] `aigon config set deepen.enabled <bool>` writes to project config (mirroring how other writeable config keys behave today; verify in `lib/config.js` before implementing).
- [ ] When deepen is gated off (either by flag or config), the slash command prompt skips the deepen step and the agent goes straight to the existing one-shot scaffolding.
- [ ] When the deepen flow runs and finishes, the agent emits a one-line hint at the end: `(Don't want this every time? Run \`aigon config set deepen.enabled false\`.)` — but only on the first ~3 deepen sessions per user (idempotent counter in user config), so it doesn't become noise.
- [ ] `aigon doctor` does not warn or error on `deepen.enabled` being set; it is a known key.
- [ ] No mention of "grill" anywhere in code, config, or prompts.

## Validation

```bash
node -c aigon-cli.js
node -c lib/config.js
aigon config show | grep -i deepen
# Behavioural smoke test:
aigon feature-create "smoke-test-quick" --quick    # should NOT run deepen
aigon feature-create "smoke-test-default"          # should reference deepen in slash command
# Clean up:
rm docs/specs/features/01-inbox/feature-smoke-test-*.md 2>/dev/null
npm test
```

## Technical Approach

- **CLI flag**: parse `--quick` in `lib/commands/feature.js` (or wherever `feature-create` and `research-create` argument parsing lives — `lib/cli-parse.js` is likely involved). The flag is a boolean; default false.
- **Config key**: extend `lib/config.js` with `deepen.enabled` (boolean, default `true`). Reuse the existing project-then-user precedence walker; do not introduce a new precedence path.
- **Effective resolution**: a single helper, e.g. `resolveDeepenEnabled({ quickFlag, repoPath })` returns the effective boolean. `--quick` always wins (disables). Otherwise project config, then user config, then default `true`.
- **Wiring into the slash command**: the `feature-create.md` and `research-create.md` prompts (built in #1 and #2) include a top-of-file conditional like:
  > If invoked with `--quick`, or if `aigon config get deepen.enabled` returns `false`, skip the Deepen step and proceed directly to "Write the spec".
  
  The prompt is interpreted by the agent, not the CLI — so this is a documentation-style condition the agent reads. The CLI's job is only to make the flag and config readable; the agent is responsible for honouring the rule. Verify that `aigon config get deepen.enabled` is a usable command path so the agent can shell-out to check it (add a one-shot getter if not present).
- **Hint emission**: the deepen prompt instructs the agent to append the hint after the spec is written, conditional on a first-N-runs counter stored in `~/.aigon/config.json` under `deepen.hintCount`. Increment after each emission; stop emitting once `hintCount >= 3`.
- **Tests**: unit tests for `resolveDeepenEnabled` covering all four precedence layers. No UI tests required — this is a CLI/config feature.
- **Restart server** after `lib/*.js` edits per CLAUDE.md hot rule #3.

## Pre-authorised

- May skip `npm run test:ui` mid-iteration — this feature touches no dashboard assets.

## Dependencies

- depends_on: deepen-create-1-feature-prompt
- depends_on: deepen-create-2-research-prompt

## Out of Scope

- A `--deepen` inverse flag for one-call opt-in when globally disabled — explicitly rejected during research-eval as unnecessary cognitive cost. If the case ever materialises, add it then.
- A standalone `aigon spec-deepen <ID>` command for deepening existing specs — explicitly deferred. `feature-spec-review` already covers post-hoc improvement.
- Changing the prompts themselves — that is features #1 and #2.
- Updating `feature-now` to pass `--quick` — that is feature #4.
- Telemetry on how often `--quick` is used or how often deepen is globally disabled.
- A spec transcript / Q&A log artifact — explicitly rejected during research-eval (sidecar reflex; spec is the contract).

## Open Questions

- Where exactly is the right place to read `--quick` — at `aigon-cli.js` dispatch level or inside the per-command handler? Implementing agent should pick the spot consistent with how other create-time flags like `--set` are read.
- Should the effective value be exposed in `aigon doctor` output (informational, not a warning)? Probably yes; defer judgement to implementing agent.

## Related

- Research: #46 guided-entity-creation
- Set: deepen-create
- Prior features in set: deepen-create-1-feature-prompt, deepen-create-2-research-prompt
