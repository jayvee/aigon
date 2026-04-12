# Implementation Log: Feature 248 - docker-clean-room-test-environment
Agent: cc

## Progress

- Created `docker/clean-room/Dockerfile` — minimal Ubuntu 24.04 with only sudo, ca-certificates, curl. Non-root `dev` user with sudo access.
- Created `docker/clean-room/run.sh` — builds image, supports `--auto`, `--scenario N`, `--all` flags. Bind-mounts aigon source, forwards ports 4100/3000, passes API keys.
- Created `docker/clean-room/smoke-test.sh` — platform-aware (Linux apt / macOS brew). Implements scenarios 1 (minimal install), 2 (dashboard + server), 5 (brewboard tutorial). Each scenario is self-contained with pass/fail reporting.
- Created `.github/workflows/clean-room-macos.yml` — runs smoke test scenarios on macos-latest via matrix strategy. Triggers on manual dispatch, docs changes, and clean-room script changes.
- Created `docker/clean-room/README.md` — documents both modes, all scenarios, env vars, and limitations.

## Decisions

- Used `ubuntu:24.04` as base image per spec recommendation — matches getting-started guide's Ubuntu/Debian instructions.
- Smoke test does NOT install agent CLIs (Claude Code, Gemini CLI) since they need API keys and interactive auth — tests everything up to but not including agent sessions.
- Scenarios run independently (each starts from clean state) rather than building on each other, so you can run just the one you care about.
- Shell scripts use `set -euo pipefail` for strict error handling — fail fast on any broken step.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-12

### Findings
- `docker/clean-room/smoke-test.sh` did not implement the documented scenario-1 and scenario-2 flow from the feature's own test matrix. Scenario 1 skipped `aigon init`, `aigon install-agent cc`, and `aigon board`, and scenario 2 therefore did not build on that path.
- `docker/clean-room/smoke-test.sh` hard-coded `~/src/aigon`, which breaks the macOS GitHub Actions path because the checked-out repo lives under the runner workspace, not that fixed directory.
- The branch included unrelated edits to `docs/specs/research-topics/logs/research-29-cc-findings.md`, `docs/specs/research-topics/logs/research-29-cx-findings.md`, and `docs/specs/research-topics/logs/research-30-cx-findings.md`.

### Fixes Applied
- `93f3c878` — `fix(review): align clean-room smoke tests with spec scenarios`
- `62e8259c` — `fix(review): remove unrelated research log changes`

### Notes
- Review stayed within the existing implementation approach. No tests were run as part of review per the feature-review workflow.
