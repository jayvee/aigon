---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T06:52:33.256Z", actor: "cli/feature-prioritise" }
---

# Feature: unattended-docker-install-test

## Summary

Build a single host-side orchestrator (`docker/clean-room/run-e2e.sh`) that performs an unattended end-to-end installation test from a cold start: ensure Docker is running, build the clean-room image, start a detached container, inject host credentials, install everything (prerequisites → agent CLIs → aigon → brewboard clone → init → install-agent → server up → dashboard responds), then **best-effort** drive one BrewBoard feature via an autonomous agent and check artifacts. Today's `run.sh --auto` stops at "dashboard responds on :4100" — it never injects creds and runs the container with `--rm` so cred injection has nowhere to land. The **must-pass core** is everything up to and including dashboard-responds; the **best-effort tail** is the autonomous feature run plus assertions. A failure in the tail logs loudly and emits a clear summary but does not fail the script — installation regressions are the primary signal we need, and they are deterministic; agent runs are not. One command (`bash docker/clean-room/run-e2e.sh`) is sufficient to validate every install change before release.

## User Stories

- [ ] As a maintainer about to publish a new aigon version, I run one command and get a pass/fail signal that a fresh Linux user can install + use aigon to complete a feature.
- [ ] As a maintainer changing the install docs or smoke-test, I can re-run the same command to confirm I didn't regress a real-world install.
- [ ] As a contributor reviewing an install-related PR, I have a script I can point to as "run this and post the exit code" rather than asking the author to manually walk a Docker shell.

## Acceptance Criteria

**Must-pass core (script exits non-zero if any of these fail):**
- [ ] New script `docker/clean-room/run-e2e.sh` exits 0 on must-pass success and non-zero with a stage-tagged error on any must-pass failure.
- [ ] The script is idempotent at the host level: re-running it after a failure leaves no orphaned containers, networks, or images that block the next run.
- [ ] OrbStack/Docker readiness is verified before any `docker` call; if not running on macOS, the script attempts `open -a OrbStack` and waits up to 60s for `docker info` to succeed (no infinite hang).
- [ ] The script runs the container **detached** (no `--rm` at boot — explicit `docker rm` on teardown), so cred injection has time to land.
- [ ] `scripts/docker-inject-creds.sh` is invoked against the running container; if zero credentials were copied, the script exits non-zero with a clear message (no silent fallback to interactive auth, since this is unattended).
- [ ] Inside the container, the existing `smoke-test.sh --scenario 2` runs to completion (install + server + dashboard HTTP check). The new script reuses it; it does **not** duplicate install logic.
- [ ] Teardown always runs (trap on EXIT): container removed, tmux sessions inside it die with the container, no leftover named volumes. Container logs are dumped to `docker/clean-room/last-run.log` for forensics on every run (success or failure), then the container is removed.
- [ ] README section "Unattended end-to-end" added, documenting prerequisites (`ANTHROPIC_API_KEY` + working `claude` host auth + OrbStack), single-command usage, expected runtime (~10–15 min for must-pass core, ~10–15 min more if best-effort tail completes), expected cost, and how to inspect a failure via `last-run.log`.
- [ ] **Safety rail**: the script refuses to run if `$CI` is set or `$AIGON_E2E_ALLOW_REMOTE` is not explicitly `1` AND it cannot detect a local Docker daemon (i.e., never accidentally injects host creds into a remote/shared Docker context).
- [ ] Final summary line clearly distinguishes outcomes, e.g. `INSTALL: PASS  FEATURE-RUN: PASS|FAIL|SKIPPED  EXIT: 0|N`.

**Best-effort tail (failures logged but do NOT fail the script):**
- [ ] After install succeeds, the orchestrator picks one BrewBoard seed feature (configurable; default = the smallest seeded feature in `01-inbox`) and runs `aigon feature-autonomous-start <ID> --stop-after <budget>` inside the container, in a tmux session. The script polls for session exit or a timeout.
- [ ] Stop-after budget is conservative (default: 1 iteration OR 5 minutes wall-clock, whichever first) and configurable via env var `AIGON_E2E_STOP_AFTER`. Designed so a single run costs <$0.50 of API credits.
- [ ] Post-execution assertions are checked and reported: (a) feature spec moved out of `01-inbox`, (b) a feature branch exists in the brewboard worktree with at least one commit beyond seed HEAD, (c) the agent's 7-section implementation log exists and is non-empty. Each assertion outcome is printed; aggregate result feeds the summary line above.
- [ ] If `feature-autonomous-start` is unavailable or unstable, this entire stage may be skipped via `AIGON_E2E_SKIP_FEATURE_RUN=1` — the must-pass core still runs and the script still exits 0.

## Validation

```bash
# Static checks while iterating; the real test is an actual run, but those are too slow / costly for the iterate loop.
bash -n docker/clean-room/run-e2e.sh
shellcheck docker/clean-room/run-e2e.sh
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May invoke `bash docker/clean-room/run-e2e.sh` once during implementation to validate the happy path. Subsequent runs require operator approval (cost control).

## Technical Approach

**Single new file: `docker/clean-room/run-e2e.sh`** — a host-side orchestrator. Existing files (`Dockerfile`, `smoke-test.sh`, `docker-inject-creds.sh`, `run.sh`) are **not modified** beyond minor fixes if discovered. Reuse, don't fork.

### Stages

Each stage is a function. Stages 1–5 are **must-pass**: failure triggers teardown + non-zero exit. Stages 6–7 are **best-effort**: failure is logged + reported in the final summary, but the script still exits 0 if must-pass succeeded. Stage 8 (teardown) always runs via `trap`.

1. **`stage_preflight`** — verify OS (macOS or Linux), `docker` binary present, `tmux` not required on host (only inside container). On macOS, if `docker info` fails, attempt `open -a OrbStack` and poll `docker info` for up to 60s. Verify `ANTHROPIC_API_KEY` is set (required — the autonomous run will need it; we cannot rely on injected `~/.claude.json` cookie alone since the agent runs headless). Verify `~/.claude` exists on host (used by `docker-inject-creds.sh`). Apply the `$CI` / `$AIGON_E2E_ALLOW_REMOTE` safety rail.

2. **`stage_build`** — `docker build -t aigon-clean-room docker/clean-room/`. No-op if image is up to date.

3. **`stage_run_detached`** — start the container detached with the same volume + port flags as `run.sh`, but **without `--rm`** and with a fixed name `aigon-e2e`. If a previous `aigon-e2e` exists, `docker rm -f` it first. Forward `ANTHROPIC_API_KEY` (and `GOOGLE_API_KEY`, `OPENAI_API_KEY` if set) via `-e`. Wait for the container to be running.

4. **`stage_inject_creds`** — call `bash scripts/docker-inject-creds.sh aigon-e2e`. Capture stdout; if it printed only `skipped:` lines (no `copied:`), abort.

5. **`stage_install`** — `docker exec -u dev aigon-e2e bash /home/dev/src/aigon/docker/clean-room/smoke-test.sh --scenario 2`. Smoke-test scenario 2 already covers prerequisites → agent CLIs → aigon → brewboard → init → install-agent → server + dashboard HTTP check.

6. **`stage_run_feature`** *(best-effort)* — pick a feature ID (default: smallest-numbered seed feature in `~/src/brewboard/docs/specs/features/01-inbox/` — discovered via `docker exec ... ls`; overridable via `AIGON_E2E_FEATURE_ID`). Skipped entirely if `AIGON_E2E_SKIP_FEATURE_RUN=1`. Inside the container:
   - Restart `aigon server` via `nohup` (smoke-test scenario 2 killed it at the end).
   - `aigon feature-autonomous-start <ID> cc --stop-after <budget>` in a named tmux session (`e2e-feature`).
   - Host poll loop: `docker exec` checks `tmux has-session -t e2e-feature` every 10s, with a hard timeout of `AIGON_E2E_STOP_AFTER` seconds (default 300). On timeout, attempt graceful tmux kill, then assertions still run on whatever state exists.
   - **Why autonomous-start, not feature-start**: `feature-start` opens an iTerm2 tab on macOS via AppleScript — that has no equivalent inside Linux Docker. `feature-autonomous-start` runs the agent CLI in `--print` (or equivalent non-interactive) mode with a stop-after budget, which is exactly the unattended-execution shape we need. Feasibility check during impl: confirm flag shape; if it differs, adapt without failing.
   - Any failure here sets `FEATURE_RUN_RESULT=FAIL` and is logged with full context, but does not abort the script.

7. **`stage_assert`** *(best-effort, only runs if stage 6 was attempted)* — inside the container, evaluate each independently and report:
   - Spec moved out of `01-inbox/` (`! ls ~/src/brewboard/docs/specs/features/01-inbox/feature-*.md | grep -q <slug>`).
   - Worktree branch exists with ≥1 commit beyond seed HEAD: `cd <worktree> && git log seed..HEAD --oneline | wc -l` ≥ 1.
   - Implementation log exists and is non-empty (path verified against current Aigon worktree layout during impl).
   - Each individual outcome is printed; the aggregate feeds the final summary line. None of these can fail the script.

8. **`stage_teardown`** (trap EXIT) — `docker logs aigon-e2e > docker/clean-room/last-run.log` (always, for forensics), then `docker rm -f aigon-e2e`.

### Key constraints

- **Reuse over rewrite.** `smoke-test.sh` and `docker-inject-creds.sh` already work; the orchestrator must call them, not duplicate them.
- **No silent fallbacks.** Every "couldn't do X, but kept going" is a real bug magnet for unattended tests. Hard-fail with a stage tag.
- **Cost discipline.** Default budget is small; document the cost; require explicit env override to raise.
- **No CI assumption.** This is a manual one-off ("run when we want to update or test the installation"). Don't add a GitHub Actions workflow as part of this feature — that's a follow-up if it proves useful.

### Files touched (estimate)

- New: `docker/clean-room/run-e2e.sh` (~200–300 LOC)
- Edited: `docker/clean-room/README.md` (add "Unattended end-to-end" section)
- Edited: `.gitignore` (add `docker/clean-room/last-run.log`)

## Dependencies

- `aigon feature-autonomous-start` must exist and support `--stop-after`. (Listed in available skills as `aigon:feature-autonomous-start: Start feature autonomous execution with explicit stop-after`.) Confirm at impl time; if unstable, scope down stage 6 as noted above.
- BrewBoard seed repo must contain at least one feature in `01-inbox/` after `aigon init`. (True today.)

## Out of Scope

- Windows support. (Aigon's clean-room is already Linux/macOS only.)
- A GitHub Actions workflow that runs this on every push. (Cost + flakiness — explicitly a manual tool.)
- npm publish dry-run integration. (Different testing concern; covered by `scripts/check-pack.js` etc.)
- Testing aigon-pro. (The orchestrator should *tolerate* aigon-pro being mounted, since `run.sh` mounts it conditionally, but aigon-pro-specific assertions are out of scope.)
- Multi-agent runs (gg + cc + cx). One agent (cc) is enough for an install-test signal; multi-agent adds time + cost without proportional confidence.

## Open Questions

- Confirm exact CLI shape of `feature-autonomous-start` (flag names, expected log paths). Resolve at impl time by reading `lib/commands/` for the handler.
- Confirm BrewBoard worktree path convention inside the container (`~/src/brewboard-worktrees/<slug>` vs `~/src/brewboard/.aigon/worktrees/<slug>` vs other). Resolve at impl time by reading current worktree-creation code.
- Should `last-run.log` be checked into git on failure? Default: no, gitignored — operator inspects locally. Reconsider if we ever want to file failure-logs as artefacts.

## Related

- Research: —
- Set: —
- Prior features in set: —
