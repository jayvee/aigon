# Feature: docker-clean-room-test-environment

## Summary

Create a clean-room test environment for validating Aigon's installation and tutorial docs end-to-end from a fresh machine. Supports two modes:

1. **Manual mode** — drop into an interactive shell on a clean OS and step through the docs as a new user would. Catches documentation gaps, unclear instructions, and missing steps.
2. **Automated mode** — a script that runs the full install + tutorial setup non-interactively, exiting non-zero on any failure. Catches regressions when aigon or its dependencies change.

Both modes target **Linux** (Docker container) and **macOS** (GitHub Actions runner or cloud Mac instance). The Linux path is the primary deliverable; the macOS path may be a GitHub Actions workflow or a script that runs on any clean Mac.

## User Stories
- [ ] As the maintainer, I want to spin up a clean Linux environment in seconds so I can manually verify the getting-started docs work end-to-end.
- [ ] As the maintainer, I want an automated script that runs the full install and tutorial setup non-interactively so I can catch regressions without stepping through every command by hand.
- [ ] As the maintainer, I want to validate the install on macOS too — not just Linux — since most Aigon users are on Macs.

## Acceptance Criteria

### Linux (Docker)
- [ ] **AC1** — A `Dockerfile` exists (e.g., `docker/clean-room/Dockerfile`) that builds a minimal Linux image (Ubuntu or Debian) with only the base OS — no Node.js, no git, no tmux, no aigon, no agent CLIs.
- [ ] **AC2** — `docker/clean-room/run.sh` builds the image and drops the user into an interactive shell (manual mode).
- [ ] **AC3** — `docker/clean-room/run.sh --auto` runs the automated install + tutorial setup script non-interactively and reports pass/fail.
- [ ] **AC4** — From inside the container (manual mode), the user can follow the Getting Started guide step by step: install prerequisites, clone aigon, `npm ci && npm link`, `aigon --version`.
- [ ] **AC5** — From inside the container (manual mode), the user can follow the Brewboard tutorial: clone the seed repo, `npm install`, `aigon init`, `aigon install-agent cc`, `aigon server start`, and access the dashboard from the host browser (port forwarded).
- [ ] **AC6** — The automated script (`docker/clean-room/smoke-test.sh`) supports `--scenario N` and `--all` flags. Each scenario exits 0 only if all its steps succeed. At minimum, scenarios 1, 2, and 5 from the test matrix must be implemented.

### macOS
- [ ] **AC7** — A GitHub Actions workflow (`.github/workflows/clean-room-macos.yml`) runs the automated smoke test on `macos-latest`.
- [ ] **AC8** — The same `smoke-test.sh` script works on both Linux and macOS (uses platform-appropriate package install: `apt` vs `brew`).

### Shared
- [ ] **AC9** — The container/runner mounts or copies the local aigon source so the user is testing the current working copy, not a stale version.
- [ ] **AC10** — The container has network access (to clone repos, install npm packages).
- [ ] **AC11** — A `README.md` in the docker directory explains both modes, how to build/run, and what the automated test validates.

## Validation
```bash
# Build the image
docker build -t aigon-clean-room docker/clean-room/
# Manual mode
docker/clean-room/run.sh
# Automated mode
docker/clean-room/run.sh --auto
```

## Technical Approach

### Linux (Docker)

**Base image:** `ubuntu:24.04` — widely used, matches the getting-started guide's Ubuntu/Debian instructions.

**Manual mode:** `run.sh` with no flags builds the image and runs `docker run -it` with:
- Bind-mount of aigon source (read-write, so `npm link` works)
- Port forwarding: 4100 (dashboard), 3000 (dev server)
- Non-root user (`dev`) with `sudo` access
- Env var passthrough for API keys (`-e ANTHROPIC_API_KEY`)

**Automated mode:** `run.sh --auto` runs the same container but executes `smoke-test.sh` instead of dropping into a shell. The script installs everything non-interactively, runs each validation step, and exits non-zero on first failure with a clear message about which step broke.

**smoke-test.sh:** Platform-aware — detects Linux vs macOS and uses the appropriate package manager. Does NOT require agent CLI binaries (Claude Code, Gemini CLI) — those need API keys and interactive auth. It tests everything up to but not including running an actual agent session.

### macOS (GitHub Actions)

**Workflow:** Triggered manually (`workflow_dispatch`) or on changes to `site/content/getting-started.mdx`, `site/content/guides/brewboard-tutorial.mdx`, or `docker/clean-room/`. Runs on `macos-latest`, checks out the repo, and executes `smoke-test.sh`.

**Why GitHub Actions for macOS:** macOS cannot run in Docker (Apple EULA). GitHub Actions provides free macOS runners for public repos with a clean environment each run. For interactive manual testing on macOS, alternatives include:
- **MacStadium** — dedicated cloud Macs, SSH access, hourly billing
- **AWS EC2 Mac instances** — `mac2.metal`, minimum 24h billing
- **Hetzner Mac Mini** — bare metal, lower cost

The GitHub Actions path covers automated validation. Manual macOS testing is left to the maintainer's own machine or a cloud Mac instance.

### Test scenarios (installation matrix)

The smoke test should cover distinct installation paths that a real user might take. Each scenario is a separate run of `smoke-test.sh` with a `--scenario` flag (or run all with `--all`):

| # | Scenario | Platform | What it tests |
|---|----------|----------|---------------|
| 1 | **Minimal single-agent** | Linux + macOS | Prerequisites → aigon → one agent (cc) → init → board. No proxy, no dashboard, no optional tools. The leanest possible install. |
| 2 | **Dashboard + server** | Linux + macOS | Scenario 1 + `aigon server start` + verify dashboard responds on 4100. Tests the most common first-time setup. |
| 3 | **With proxy** | Linux (Docker `--privileged`) | Scenario 2 + `aigon proxy install` + verify `.localhost` routing works. Tests the proxy setup docs and port 80 binding. |
| 4 | **Multi-agent Fleet** | Linux + macOS | Prerequisites → aigon → two agents (cc + gg) → init → `aigon install-agent cc gg` → board shows both. Tests that Fleet-mode prerequisites are met. |
| 5 | **Brewboard tutorial** | Linux + macOS | Full tutorial path: clone seed → init → install-agent → server start → board shows seeded features → dev-server start → verify dev server responds. Everything short of an actual agent session. |

Each scenario builds on the previous one conceptually, but they run independently (each starts from a clean state). This lets you run just the scenario you care about or the full matrix.

**Scenario selection:**
```bash
# Run one scenario
docker/clean-room/run.sh --auto --scenario 2
# Run all scenarios sequentially
docker/clean-room/run.sh --auto --all
# Manual mode (always starts clean, you pick your own path)
docker/clean-room/run.sh
```

### macOS manual testing

For interactive macOS testing (not just CI), the options are:

| Option | Cost | Interactive? | Clean each run? | Notes |
|--------|------|-------------|-----------------|-------|
| **GitHub Actions** (`macos-latest`) | Free (public repo) | No — automated only | Yes | Best for automated smoke tests |
| **MacStadium** | ~$50/mo or hourly | Yes — SSH | Can reimage | Dedicated Mac mini in the cloud |
| **AWS EC2 Mac** (`mac2.metal`) | ~$6.50/hr (24h min) | Yes — SSH | Yes (new host) | Expensive but fully clean |
| **Hetzner Mac Mini** | ~€50/mo | Yes — SSH | Can reimage | Cheaper than AWS, EU-based |
| **Spare Mac / VM** | Free (if you have one) | Yes | Manual wipe | `createinstallmedia` USB + reinstall |

For regular automated validation, GitHub Actions is sufficient. For manual walk-throughs matching a real first-time Mac user, MacStadium is the most practical option.

### What the smoke test does NOT cover
- Running an actual agent session (requires API keys + agent CLI binary)
- The full Brewboard tutorial interactive workflow (feature-do, feature-close)
- Dashboard UI verification beyond HTTP response (no browser — just checks the server responds)

## Dependencies
- Docker installed on the host machine (for Linux path)
- GitHub Actions (for macOS path)
- Getting Started guide (`site/content/getting-started.mdx`)
- Brewboard tutorial (`site/content/guides/brewboard-tutorial.mdx`)
- brewboard-seed repo on GitHub

## Out of Scope
- Testing agent CLI installation or actual agent sessions (requires API keys and interactive auth)
- Full interactive tutorial automation beyond setup (feature-do, feature-close — those need a live agent)
- CI/CD merge gating (this is a validation tool, not a blocker — for now)
- Windows testing
- Provisioning or managing cloud Mac instances (the spec documents options; the maintainer provisions manually)

## Open Questions
- Should the automated smoke test also verify the docs site builds (`npm run build --prefix site`)?
- For the GitHub Actions macOS workflow, should it run on every push to `main` or only on manual trigger / docs changes?
- Should there be a scenario that tests the Fedora/Arch install paths from the getting-started guide, or is Ubuntu sufficient?

## Related
- Getting Started guide: `site/content/getting-started.mdx`
- Brewboard tutorial: `site/content/guides/brewboard-tutorial.mdx`
- Proxy setup docs (newly added to getting-started)
