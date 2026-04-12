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
- [ ] **AC6** — The automated script (`docker/clean-room/smoke-test.sh`) runs the following steps and exits 0 only if all succeed:
  1. Install prerequisites (Node.js 18+, git, tmux) via apt
  2. Clone and link aigon from the mounted/copied source
  3. `aigon --version` succeeds
  4. `aigon doctor` passes
  5. Clone brewboard-seed, `npm install`
  6. `aigon init` succeeds
  7. `aigon install-agent cc` succeeds (without Claude Code binary — should warn but not fail)
  8. `aigon server start` starts and responds on port 4100
  9. `aigon board --list` shows the seeded features

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

### What the smoke test does NOT cover
- Running an actual agent session (requires API keys + agent CLI binary)
- The proxy setup (requires port 80 / elevated permissions)
- The full Brewboard tutorial interactive workflow (feature-do, feature-close)
- Dashboard UI verification (no browser in the container — just checks the HTTP server responds)

## Dependencies
- Docker installed on the host machine (for Linux path)
- GitHub Actions (for macOS path)
- Getting Started guide (`site/content/getting-started.mdx`)
- Brewboard tutorial (`site/content/guides/brewboard-tutorial.mdx`)
- brewboard-seed repo on GitHub

## Out of Scope
- Testing agent CLI installation or agent sessions (requires API keys and auth)
- Full interactive tutorial automation (the manual path is the point for that)
- CI/CD gating (this is a validation tool, not a merge blocker — for now)
- Windows testing

## Open Questions
- Should the automated smoke test also verify the docs site builds (`npm run build --prefix site`)?
- Should we forward port 80 for proxy testing in Docker? Requires `--privileged` or `--cap-add NET_BIND_SERVICE`.
- For the GitHub Actions macOS workflow, should it run on every push to `main` or only on manual trigger / docs changes?

## Related
- Getting Started guide: `site/content/getting-started.mdx`
- Brewboard tutorial: `site/content/guides/brewboard-tutorial.mdx`
- Proxy setup docs (newly added to getting-started)
