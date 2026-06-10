---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-10T02:11:55.231Z", actor: "cli/feature-prioritise" }
---

# Feature: E2E harness isolates tmux to a dedicated socket so test runs don't poison the user's default tmux server HOME/env

## Summary
The Playwright dashboard E2E harness spawns `aigon server start` with a fake `HOME` (`/tmp/aigon-e2e-home-*`) and test-only env (`AIGON_TEST_MODE=1`, `AIGON_FORCE_PRO=true`, `PLAYWRIGHT_TEST=1`, `MOCK_DELAY=fast`, test git identity). Because `runTmux()` (`lib/worktree.js`) talks to the **default tmux server with no socket isolation** (`-L`/`-S`), the first tmux command the test issues can bootstrap/own the user's shared tmux server — snapshotting the fake `HOME` and test env into the server's **global environment**. Every tmux session created afterward (including real agent sessions and autonomous orchestrator loops) inherits the fake `HOME`. This makes `firstRunComplete()` return false → the onboarding setup wizard fires inside autonomous runs, and `claude` reads a test `~/.claude` with no valid OAuth → login/keychain failures. Fix: isolate all test tmux usage to a dedicated, per-run socket and tear it down, so a test run can never touch the user's default tmux server.

## Diagnosis (observed incident, 2026-06-10)
- Symptom 1: running an autonomous feature in `~/src/diviner` showed the "Aigon Setup Wizard" (terminal prompt + "Which AI agents do you want to install?") instead of running the feature.
- Symptom 2: creating a feature with claude from the dashboard tried to log in and failed with a macOS keychain error.
- Root cause (proven): `tmux show-environment -g` on the user's default server returned `HOME=/var/folders/.../T/aigon-e2e-home-hFZph7`, `PWD=.../aigon-e2e-dashboard-*`, plus `AIGON_TEST_MODE=1`, `AIGON_FORCE_PRO=true`, `PLAYWRIGHT_TEST=1`, `MOCK_DELAY=fast`, and a test git identity — i.e. a leaked E2E test environment.
- Proof: aigon's first-run gate logic, evaluated inside a fresh `bash -lc` tmux pane, returned `firstRunComplete: FALSE` with the fake HOME; in a direct shell it returned `TRUE(onboarded)`.
- Manual remediation applied: `tmux setenv -g HOME /Users/jviner` + `tmux setenv -gu` for each leaked test var. Non-destructive (no sessions killed); verified a fresh session then reported the correct HOME and `firstRunComplete: TRUE`. This feature makes the harness incapable of causing it again.

## User Stories
- [ ] As a maintainer, I can run the full Playwright E2E suite (`npm run test:browser` / `test:deploy`) without it mutating or bootstrapping my everyday tmux server, so my real agent sessions and autonomous runs keep a correct `HOME`/env.
- [ ] As a user, after any test run, new autonomous feature runs never show the onboarding setup wizard and `claude` sessions authenticate against my real `~/.claude` / keychain.

## Acceptance Criteria
- [ ] All tmux invocations made during the E2E harness target a dedicated socket (`tmux -L aigon-e2e-<pid>` or `TMUX_TMPDIR`-scoped), never the default server.
- [ ] `runTmux()` honors an env-configurable socket (e.g. `AIGON_TMUX_SOCKET` → injects `-L <name>` / `-S <path>`) so the same code path is exercised in tests and prod, with prod defaulting to the normal default server.
- [ ] The E2E harness teardown runs `tmux -L <socket> kill-server` (best-effort) so no orphan test server/sessions survive a run.
- [ ] After running the E2E suite locally, `tmux show-environment -g` on the user's default server shows no `aigon-e2e-home-*` HOME and none of: `AIGON_TEST_MODE`, `PLAYWRIGHT_TEST`, `MOCK_DELAY`, test git identity vars.
- [ ] Defense in depth: a poisoned/incorrect `HOME` can no longer surface the onboarding wizard inside automation — either `feature-autonomous-start` is added to `SKIP_FIRST_RUN` or the auto orchestrator loop exports `AIGON_SKIP_FIRST_RUN=1` (document why this alone is insufficient: it does not fix claude auth, which genuinely needs the correct HOME).
- [ ] Regression test/assertion: a test (or CI check) verifies the default tmux server's global env is untouched after an E2E run.

## Technical Approach
- Add socket support to `runTmux()` in `lib/worktree.js` (and the duplicate in `lib/budget-poller.js`): when `AIGON_TMUX_SOCKET` (name) or `AIGON_TMUX_SOCKET_PATH` is set, prepend `-L <name>` / `-S <path>` to every tmux args array. Single chokepoint — all tmux calls already route through `runTmux`.
- In `tests/dashboard-e2e/setup.js`: generate a per-run socket name, set it in the spawned dashboard env (`AIGON_TMUX_SOCKET=aigon-e2e-<pid>`), and `kill-server` that socket in teardown.
- Audit other test harnesses that spawn `aigon`/tmux (workflow/integration e2e) for the same leak and apply the same socket scoping.
- Verify against the existing hazard comment at `lib/worktree.js:160` (fake-HOME keychain prompts) — socket isolation should also remove that prompt risk.

## Dependencies
-

## Out of Scope
- Changing how production agent sessions use the default tmux server (prod behavior unchanged; only adds opt-in socket override).
- The interactive onboarding wizard's own logic (only the gate's exposure inside automation is touched, as defense in depth).

## Open Questions
- `-L` (named socket in `TMUX_TMPDIR`) vs `-S` (explicit socket path under the test's temp HOME) — pick whichever the harness can most reliably clean up.
- Should `runTmux`'s socket override live in `lib/worktree.js` only, or be hoisted to a shared tmux helper so `budget-poller.js`'s copy stays in sync?

## Out of Scope / Related
- Related incident signature for fast future diagnosis: setup wizard in autonomous runs + claude keychain/login failure simultaneously ⇒ check `tmux show-environment -g HOME`.

## Related
- Existing hazard comment: `lib/worktree.js:160-163` (e2e fake-HOME triggers macOS keychain prompts).
- Producer: `tests/dashboard-e2e/setup.js:84-101` (fake HOME + test env).
- tmux chokepoint: `lib/worktree.js:1465 runTmux`, duplicate `lib/budget-poller.js:24`.
- First-run gate: `aigon-cli.js:252-260`, `SKIP_FIRST_RUN` set `aigon-cli.js:100-114`, `firstRunComplete()` `aigon-cli.js:116-139`.
