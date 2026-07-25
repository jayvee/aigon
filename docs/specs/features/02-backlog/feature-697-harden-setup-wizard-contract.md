---
aigon_id: F697
complexity: high
set: docs-release-readiness
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-25T00:22:10.548Z", actor: "cli/feature-prioritise" }
---

# Feature: harden-setup-wizard-contract

## Summary

Make `aigon setup` safe, resumable, testable, and truthful before the next release. The
current nine-step wizard contradicts its original F337 contract: `--resume` cannot rerun
skipped steps, `--yes` clones Brewboard and starts a server, agent authentication is keyed
by the wrong identifiers, server success is never health-checked, the seed is applied twice,
config/Git writes are unsafe, and command-local `--help` can execute the command instead of
showing help. Correct those behaviors and their dedicated public setup documentation while
deliberately preserving the current Aigon Pro step, wording, package gate, and vault gate;
F695 in the separate `pro-merge` set owns their later removal.

## User Stories

- [ ] As a new user, setup finishes with agents and a dashboard that actually work, or
      clearly reports the step that failed.
- [ ] As a user who skipped or interrupted a step, I can resume or explicitly rerun it
      without repeating unrelated completed work.
- [ ] As a CI/non-interactive user, `setup --yes` applies conservative local defaults and
      performs no unexpected clone, package install, authentication, or server start.
- [ ] As a security-conscious user, values entered into setup cannot become shell commands
      and any config containing a credential is private to my account.
- [ ] As a maintainer, wizard behavior is covered by focused tests rather than a single
      Docker happy path.
- [ ] As a user exploring the setup commands, `--help` is always read-only and the published
      setup guide describes the behavior I will actually see.

## Acceptance Criteria

### One persisted step contract

- [ ] `STEP_IDS` has one source of truth in `lib/onboarding/state.js`; first-run logic in
      `aigon-cli.js`, summaries, resume logic, and validation import it rather than duplicate
      the nine values.
- [ ] `setup --resume` reruns the first skipped or incomplete step and then considers each
      later step independently; it no longer reports “Nothing to resume” when skipped steps
      exist.
- [ ] Add `--step <id>` (repeatable) so an operator can rerun exactly the named step(s)
      without resetting the full wizard. A `--from <id>` range form is deliberately **not**
      added: `--resume` already means "continue from where I stopped", so `--from` would
      duplicate it while `--step` covers the stated need (retry server/auth/seed alone).
      Invalid step IDs fail with usage and non-zero status.
- [ ] SIGINT and step failure persist enough state for a subsequent resume without setting
      `completedAt` or `onboarded: true` prematurely.
- [ ] A failed step persists as `failed` rather than reverting to missing, so `--resume`
      and the summary can distinguish "never reached" from "tried and broke".
- [ ] `global-setup --force` is documented and implemented only as machine configuration;
      it is not presented as a clean rerun of all wizard steps.

### Side-effect-free command help

- [ ] Global argument handling intercepts command-local `--help`/`-h` before execution for
      every public command and subcommand. Fix this centrally in `aigon-cli.js` dispatch so
      no individual handler can forget the guard.
- [ ] `aigon feature-create --help`, `aigon setup --help`, lifecycle mutations, server
      commands, and Pro stubs print usage without changing files, workflow/config state,
      processes, or network state.
- [ ] A temporary-repo/HOME regression test runs a representative help-command matrix and
      proves filesystem and process-relevant state is unchanged.

### Safe unattended and interactive defaults

- [ ] `setup --yes` follows F337's negative/safe defaults: no agent install, no Brewboard
      clone, no existing-repo registration without explicit environment selection, no
      dashboard start, no demo, and no Pro install/activation unless the already-supported
      explicit Pro environment contract requests it.
- [ ] Interactive agent selection does not preselect every missing CLI. The operator must
      positively choose agents to install; already-installed agents are not reinstalled
      unless selected.
- [ ] Agent auth uses registry IDs and each agent's real binary/auth metadata. Remove the
      hardcoded table that maps neither `agent:cc` nor `agent:cx`; an unsupported auth flow
      is reported as manual rather than silently skipped.
- [ ] Terminal options come from the terminal adapter registry and the selected/default
      behavior is represented accurately in the completion summary.

### Secure config and process execution

- [ ] All global config writes use one atomic writer, create new files with mode `0600`,
      preserve or tighten existing permissions, and retain the existing backup behavior.
- [ ] The onboarding-only `writeGlobalConfig()` duplicate is removed or delegates to the
      canonical config API. A Pro key written by the existing step therefore never lands in
      a newly created `0644` file.
- [ ] Git name/email configuration uses argument-array execution (`execFileSync` or
      `spawnSync`) and never interpolates prompt text into a shell command.
- [ ] Tests include values containing spaces, quotes, backticks, and shell-substitution
      syntax and prove no command execution occurs.

### Seed, server, and demo correctness

- [ ] Brewboard is installed through the canonical seed/install behavior where practical;
      the wizard does not duplicate `aigon apply` and does not retain Mac-specific generated
      files from the source seed.
- [ ] A custom seed target is persisted and used by repo registration and the demo; later
      steps do not fall back to `~/src/brewboard`.
- [ ] The demo selects an installed/available launchable agent rather than hardcoding `cc`,
      and it describes whether it starts a supervised feature or an autonomous run.
- [ ] Interactive setup offers to start the persistent dashboard server and defaults that
      prompt to yes. On acceptance it runs `aigon server start --persistent`, polls a health
      endpoint, records `done` only after success, and reports logs/remediation on failure.
      `setup --yes` remains conservative and does not start the server.
- [ ] Server start respects the loopback/security configuration and does not imply LAN
      exposure by default.

### Public setup documentation

- [ ] Getting Started's setup passages, Setup Wizard, the `setup` command reference, and
      clean-room installation material describe the implemented nine-step flow,
      `--resume`/repeatable `--step`, conservative `--yes`, terminal and agent-auth behavior,
      seed/demo choices, persistent server default, health-check failure, and safe help.
- [ ] `global-setup --force` is described only as machine-configuration regeneration, never
      as restarting the wizard from step one.
- [ ] Setup-specific screenshots and examples are refreshed where the behavior or step count
      changed, at desktop and 390px mobile. F698 owns the rest of the public corpus and must
      not rewrite these setup facts.

### Tests

- [ ] Add focused state-table coverage for fresh, done, skipped, partial, cancelled, legacy,
      `--resume`, and explicit-step cases.
- [ ] Add a dependency-injected wizard harness that records install/clone/config/server
      actions without global mocks or real external side effects.
- [ ] Add a clean temporary-HOME integration proving config mode `0600`, safe `--yes`,
      no duplicate seed apply, and failed health check not marked done.
- [ ] Update the Docker quick-install test so it asserts the conservative `--yes` contract
      rather than compensating for undocumented side effects.
- [ ] Every test carries a `// REGRESSION:` comment and the test LOC ceiling stays green by
      consolidating obsolete or duplicated wizard/install coverage first.
- [ ] **The budget is already red at review time**: `scripts/check-test-budget.sh` reports
      17255 LOC against a 17225 ceiling, so the Validation block below fails before any work
      starts. As an upstream feature in the set, F697 owns clearing that pre-existing overage
      *and* funding its own focused coverage; F698/F699 must not inherit a red budget. If
      nothing can be consolidated, stop and ask before raising the ceiling.

## Validation

```bash
node tests/unit/onboarding-state.test.js
node tests/integration/onboarding-wizard.test.js
npm run test:iterate
bash scripts/check-test-budget.sh
npm run build --prefix site
```

Exact test filenames may follow existing repository conventions, but both pure state and
isolated end-to-end behavior must be covered.

## Pre-authorised

- May create temporary HOME directories and scratch repositories for wizard integration tests.
- May skip full browser tests mid-iteration because this feature does not change dashboard assets.

## Technical Approach

First extract a testable wizard runtime boundary: prompts and real process/filesystem actions
remain adapters; step decisions consume injected capabilities and return explicit results.
Do not replace the wizard with a mock-heavy abstraction—keep tests centered on observable
state and command effects.

Make state selection pure and table-driven. Treat `done`, `skipped`, missing, and failed as
distinct values; `--resume` explicitly includes skipped while ordinary first-run completion
may continue treating an intentional skip as complete.

Route config through the canonical writer and process execution through argv APIs. Fix the
global help guard early because it is small, user-visible, and required to inspect the setup
surface safely. Then fix seed/server/demo behavior and update the setup-owned public pages in
this feature. Restart the dashboard after `lib/*.js` edits.

### Verified defect anchors (added by spec review)

Each Summary claim was confirmed against the tree at `bbf64b21c`; start from these rather than
re-deriving them:

| Defect | Location |
|---|---|
| `STEP_IDS` duplicated | `aigon-cli.js:137` vs `lib/onboarding/state.js:8` |
| `--resume` skips skipped steps | `state.js:43` — `!state.steps[id]` treats `'skipped'` as truthy |
| `--yes` clones Brewboard | `wizard.js:440` — `doClone = yesFlag` |
| `--yes` starts the server | `wizard.js:625` — `doStart = yesFlag` |
| No health check; `done` written anyway | `wizard.js:640-651` — detached `spawn`, `setTimeout(2000)`, then `writeStepState('server','done')` |
| Server start is not `--persistent` | `wizard.js:645` — plain `server start` |
| Git config shell interpolation | `wizard.js:215-216` — `execSync(\`git config --global user.name ${JSON.stringify(name)}\`)`; JSON quoting still leaves backticks and `$()` shell-active inside double quotes |
| `writeGlobalConfig()` duplicate | `wizard.js:106`, used at `:389` and `:425` (the Pro-key write) |
| Demo hardcodes `cc` and the seed path | `wizard.js:657` (`~/src/brewboard`), `wizard.js:672` (`spawnSync('claude', …)`), `wizard.js:710` (`feature-start <id> cc`) |
| Command-local help executes handlers | `aigon-cli.js:258` only treats `--help` as help when it is the resolved first argument |

## Dependencies

- No intra-set dependency. F696 is closed (`05-done`, commits on `main`), so this starts clean.
- F698 runs independently and owns the non-setup documentation corpus. F699 depends on both
  features so its checker locks in both corrected baselines.

## Out of Scope

- Removing, renaming, repositioning, or rewording the Aigon Pro setup step.
- Ungating the vault step or removing `AIGON_PRO_KEY`; F695 owns that after F693.
- Changing Aigon Pro availability, packaging, beta-channel, or product terminology.
- Broad setup-command module migration; F631 owns that architecture.
- Editing or resetting the actual Brewboard seed repositories.
- Site-wide lifecycle, agent, product, dashboard-security, navigation, and visual cleanup;
  F698 owns those surfaces.

## Decisions

- Use repeatable `--step <id>`; `--from` would duplicate `--resume`.
- A failed step stays `failed` so resume can distinguish it
  from "never reached".
- Interactive setup defaults the persistent dashboard prompt to yes, but success is recorded
  only after the health check. Non-interactive `--yes` never starts it.
- The live global `--help` dispatch bug belongs here rather than waiting behind the docs pass,
  because setup exposes the same unsafe behavior and F697 is independently startable.

## Related

- F337 — original onboarding wizard contract.
- F418 — Brewboard demo feature.
- F631 — setup-command module migration.
- F695 — future Pro-step removal, explicitly separate from this feature.
- F699 — release checker that consumes the corrected setup documentation baseline.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 697" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-697" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-697)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#697</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">harden setup wizard contr…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#699</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">automate docs release qua…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
