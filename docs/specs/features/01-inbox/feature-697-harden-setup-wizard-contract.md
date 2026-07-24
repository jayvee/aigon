---
aigon_id: F697
complexity: high
set: docs-release-readiness
---

# Feature: harden-setup-wizard-contract

## Summary

Make `aigon setup` safe, resumable, testable, and truthful before the next release. The
current nine-step wizard contradicts its original F337 contract: `--resume` cannot rerun
skipped steps, `--yes` clones Brewboard and starts a server, agent authentication is keyed
by the wrong identifiers, server success is never health-checked, the seed is applied twice,
and config/Git writes are unsafe. Correct those behaviors while deliberately preserving the
current Aigon Pro step, wording, package gate, and vault gate; F695 in the separate
`pro-merge` set owns their later removal.

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

## Acceptance Criteria

### One persisted step contract

- [ ] `STEP_IDS` has one source of truth in `lib/onboarding/state.js`; first-run logic in
      `aigon-cli.js`, summaries, resume logic, and validation import it rather than duplicate
      the nine values.
- [ ] `setup --resume` reruns the first skipped or incomplete step and then considers each
      later step independently; it no longer reports “Nothing to resume” when skipped steps
      exist.
- [ ] Add a precise single-step/from-step mechanism (`--step <id>` or `--from <id>`) so an
      operator can retry server/auth/seed setup without resetting the full wizard. Invalid
      step IDs fail with usage and non-zero status.
- [ ] SIGINT and step failure persist enough state for a subsequent resume without setting
      `completedAt` or `onboarded: true` prematurely.
- [ ] `global-setup --force` is documented and implemented only as machine configuration;
      it is not presented as a clean rerun of all wizard steps.

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
- [ ] If the wizard promises persistence, it runs `aigon server start --persistent`;
      otherwise the prompt and docs say the server is session-local. In either case it polls
      a health endpoint, records `done` only after success, and reports logs/remediation on
      failure.
- [ ] Server start respects the loopback/security configuration and does not imply LAN
      exposure by default.

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

## Validation

```bash
node tests/unit/onboarding-state.test.js
node tests/integration/onboarding-wizard.test.js
npm run test:iterate
bash scripts/check-test-budget.sh
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

Route config through the canonical writer and process execution through argv APIs. Then fix
seed/server/demo behavior and finally align the public guide in F698. Restart the dashboard
after `lib/*.js` edits.

## Dependencies

- No intra-set dependency; this can run in parallel with F696.
- F698 depends on this feature so the docs describe the corrected contract.

## Out of Scope

- Removing, renaming, repositioning, or rewording the Aigon Pro setup step.
- Ungating the vault step or removing `AIGON_PRO_KEY`; F695 owns that after F693.
- Changing Aigon Pro availability, packaging, beta-channel, or product terminology.
- Broad setup-command module migration; F631 owns that architecture.
- Editing or resetting the actual Brewboard seed repositories.

## Open Questions

- Prefer `--step <id>` (one step only) or `--from <id>` (resume from a chosen point)?
  Recommend supporting one precise form, not both aliases.
- Should a failed optional step remain `failed` for resume visibility or return to missing?
- Should persistent server setup remain the interactive default after a successful health check?

## Related

- F337 — original onboarding wizard contract.
- F418 — Brewboard demo feature.
- F631 — setup-command module migration.
- F695 — future Pro-step removal, explicitly separate from this feature.
