---
complexity: high
depends_on: feature-336-onboarding-prereq-detectors
---

# Feature: onboarding-wizard

## Summary

Build `aigon onboarding` — a first-run wizard powered by `@clack/prompts` that walks a new user through prerequisites, terminal preference, agent CLI installation, an optional seed repo clone (brewboard), and an optional server start. A first-run detector in `aigon-cli.js` auto-invokes the wizard when `~/.aigon/config.json` is absent. `--yes` / `--resume` flags and a persisted state file (`~/.aigon/onboarding-state.json`) make every step idempotent and CI-safe. The existing `aigon global-setup` command is preserved but updated to delegate its terminal-preference logic to the wizard's shared helpers.

## User Stories

- [ ] As a brand-new user who just ran `npm i -g @aigon/cli`, when I run any `aigon` command for the first time, the wizard launches automatically and guides me from zero to a running project.
- [ ] As a user who interrupted setup, I run `aigon onboarding --resume` and the wizard skips completed steps and starts at the first incomplete one.
- [ ] As a CI script, I run `aigon onboarding --yes` and it applies defaults, writes the config and state files, and exits 0 without prompting.
- [ ] As a user who wants a playground project immediately, I accept the "clone brewboard seed repo" offer and have a ready-to-use aigon project at the end of setup.
- [ ] As a returning user, I run `aigon onboarding` and it detects that setup is complete, prints a summary, and exits without re-running steps.

## Acceptance Criteria

- [ ] `aigon onboarding` command registered in `aigon-cli.js` and in the `setup` names list (line ~3852 of `lib/commands/setup.js`).
- [ ] `aigon setup` is an alias for `aigon onboarding`.
- [ ] First-run detection: if `~/.aigon/config.json` does not exist, any top-level `aigon` command (except `onboarding`, `setup`, `--version`, `--help`, `check-version`) prepends the wizard call before executing. Detection is skipped once `~/.aigon/onboarding-state.json` has all steps complete, or `onboarded: true` in `~/.aigon/config.json`.
- [ ] Wizard uses `@clack/prompts` (`intro`, `group`, `spinner`, `note`, `confirm`, `multiselect`, `text`, `outro`). No raw `readline` or bare `console.log` prompt banners inside the wizard flow.
- [ ] Six steps executed in order, each tracked in the state file:
  1. **prereqs** — run all detectors from F336; spinner per item; offer `confirm()` + inline `install()` for soft-failing deps (tmux, gh); hard-failing deps (node, git) print remediation and abort the wizard with exit 1.
  2. **terminal** — pick terminal app (macOS only; Linux skips); writes `terminalApp` to `~/.aigon/config.json`; replaces the equivalent readline loop in `global-setup`.
  3. **agents** — `multiselect()` from agent registry (all registered agents); for each selected agent, `spinner()` → `install()` → `verify()` from F336 detectors; print install output on failure but continue to next agent.
  4. **seed-repo** — `confirm()` offer to clone `https://github.com/jayvee/brewboard-seed.git`; `text()` for target dir (default `~/src/brewboard`); `spinner()` around `git clone`; `spinner()` around `aigon init` inside clone dir; `note()` with `cd <path>` instruction. If declined or clone fails, marks step `'skipped'` and continues.
  5. **server** — `confirm()` offer to run `aigon server start` now; if yes, starts in background and prints dashboard URL; skippable.
  6. **done** — `outro()` summary of completed/skipped steps; sets `onboarded: true` in `~/.aigon/config.json`.
- [ ] State file `~/.aigon/onboarding-state.json` structure: `{ steps: { prereqs: 'done'|'skipped'|null, terminal: ..., agents: ..., 'seed-repo': ..., server: ... }, completedAt: <iso>|null }`. Each step written immediately on completion/skip.
- [ ] `--resume` flag: reads state file, skips steps with status `'done'` or `'skipped'`, starts at first `null` step.
- [ ] `--yes` flag: skips all `confirm()` prompts with the negative/safe default (no auto-install of agents, no seed clone, no server start); applies defaults for `text()` and `multiselect()`; writes state file identically to interactive path.
- [ ] Non-interactive guard: if `!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI` and `--yes` is not set, prints one line and exits 0 without running steps.
- [ ] `aigon global-setup` continues to work unchanged externally.
- [ ] `@clack/prompts` added to `package.json` dependencies.
- [ ] SIGINT during the wizard: `clack.cancel('Setup cancelled.')` then `process.exit(0)` — no stack trace.
- [ ] `npm test` passes; existing `global-setup`, `doctor`, and `check-prerequisites` behaviour is unchanged.

## Validation

```bash
node --check lib/commands/setup.js
node -e "require('./lib/commands/setup.js')"
npm test
```

## Pre-authorised

- May add `@clack/prompts` to `package.json` and run `npm install` without stopping to confirm.
- May skip `npm run test:ui` when changes touch only `lib/` and no dashboard assets.
- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if new wizard unit tests require it.

## Technical Approach

**New handler: `lib/commands/setup.js` → `'onboarding'`**

The handler lives alongside `global-setup`. It is the only place that imports `@clack/prompts`. Extract to `lib/onboarding/wizard.js` only if the handler body exceeds ~350 lines.

**SIGINT guard (first thing in the handler):**
```js
process.on('SIGINT', () => { clack.cancel('Setup cancelled.'); process.exit(0); });
```

**Step state helpers (inline or `lib/onboarding/state.js`):**
```js
function readOnboardingState() { /* JSON.parse(~/.aigon/onboarding-state.json) || {} */ }
function writeStepState(stepId, status) { /* merge + write atomically */ }
function isOnboardingComplete(state) { /* all steps 'done'|'skipped' */ }
```

**First-run gate in `aigon-cli.js`:**
```js
const SKIP_FIRST_RUN = new Set(['onboarding', 'setup', '--version', '--help', 'check-version', 'update']);
if (!SKIP_FIRST_RUN.has(command) && !firstRunComplete()) {
    await commands['onboarding']([]);
}
```
`firstRunComplete()` checks `~/.aigon/onboarding-state.json` completeness OR `onboarded: true` in `~/.aigon/config.json`.

**Step 4 — Seed repo clone:**
```js
const targetDir = path.resolve(answer.trim() || path.join(os.homedir(), 'src', 'brewboard'));
// git clone --depth 1 <url> <targetDir>  with stdio: 'pipe'
// then: spawnSync(process.execPath, [aigonCli, 'init'], { cwd: targetDir, stdio: 'inherit' })
// then: clack.note(`cd ${targetDir}`, 'Next step')
```
Clone failures write `'skipped'` to the state file and continue — never abort the wizard on network errors.

**`--yes` defaults:**
- terminal: platform default (`iterm2` on macOS, `null` on Linux)
- agents: empty selection (don't silently shell-out installs)
- seed-repo: skip (opt-in only)
- server: skip

## Dependencies

- depends_on: feature-336-onboarding-prereq-detectors
- External: `@clack/prompts` (npm, ~4 KB gzipped)

## Out of Scope

- Custom prompt types beyond `@clack/prompts` built-ins.
- `aigon doctor` integration (F336 covers that bridge via `prerequisite-checks.js`).
- A full-screen `ink`-based TUI.
- Windows support for the seed-repo clone step (Windows gets the skip path).
- Auto-starting the wizard via a postinstall npm script.
- Multiple seed repo choices (brewboard only for v1; add `select()` later).
- Profile selection during onboarding (user runs `aigon init` in their own project separately).

## Open Questions

- Should `--yes` auto-select any agents? Current spec says no — opt-in only. Revisit if user feedback pushes for it.
- Should the first-run gate suppress itself if the user passes `--help` to any command? Treat `--help` as a SKIP_FIRST_RUN entry.

## Related

- Research: 39 — tui-onboarding-wizard-frameworks
- Set: onboarding
- Prior features in set: F336 (onboarding-prereq-detectors)
