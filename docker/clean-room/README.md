# Aigon Clean-Room Test Environment

Validates Aigon's installation and tutorial docs end-to-end from a fresh machine. Two modes:

- **Manual mode** — interactive shell on a clean OS; step through docs as a new user
- **Automated mode** — non-interactive smoke test; exits non-zero on any failure

## Quick Start

```bash
# Build the image
docker build -t aigon-clean-room docker/clean-room/

# Manual mode — interactive shell
docker/clean-room/run.sh

# Automated mode — run all scenarios
docker/clean-room/run.sh --auto --all

# Automated mode — specific scenario
docker/clean-room/run.sh --auto --scenario 1
```

## Manual Mode

Drops you into a bash shell on a minimal Ubuntu 24.04 container. No Node.js, git, tmux, or aigon are pre-installed — you start from zero.

The aigon source is bind-mounted at `~/src/aigon`. Follow the [Getting Started guide](https://aigon.build/getting-started) from step 1:

```bash
# Inside the container:
sudo apt update && sudo apt install -y nodejs npm git tmux
cd ~/src/aigon && npm ci && sudo npm link
aigon --version
```

Ports forwarded to the host:
- **4100** — Aigon dashboard
- **3000** — Dev server (e.g., brewboard)

## Automated Mode (Smoke Test)

Runs `smoke-test.sh` inside the container. Each scenario installs prerequisites, sets up aigon, and validates a specific path through the docs.

### Scenarios

| # | Name | What it tests |
|---|------|---------------|
| 1 | Minimal single-agent | Prerequisites, aigon install, config, init, install-agent `cc`, board, doctor |
| 2 | Dashboard + server | Scenario 1 setup path + aigon server + dashboard HTTP check |
| 5 | Brewboard tutorial | Clone seed, init, install-agent, server, board, dev-server |

```bash
# Run one scenario
docker/clean-room/run.sh --auto --scenario 2

# Run all
docker/clean-room/run.sh --auto --all
```

### Platform support

The smoke test script detects Linux vs macOS and uses the appropriate package manager (`apt` vs `brew`). On macOS, run `smoke-test.sh` directly (no Docker needed):

```bash
# On a clean Mac (or GitHub Actions runner):
docker/clean-room/smoke-test.sh --all
```

The script resolves the checked-out aigon repo from its own location, so the same file works both inside the Docker bind mount and on a GitHub Actions macOS checkout.

## Environment Variables

API keys are forwarded to the container if set:

- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `OPENAI_API_KEY`

These are not required for the smoke test (no agent sessions are run), but are available if you want to test further in manual mode.

## What the Smoke Test Does NOT Cover

- Running actual agent sessions (requires API keys + agent CLI binaries)
- Full interactive tutorial workflow (feature-do, feature-close)
- Dashboard UI verification beyond HTTP response
- Windows

## macOS CI

The GitHub Actions workflow at `.github/workflows/clean-room-macos.yml` runs the smoke test on `macos-latest`. It triggers on:
- Manual dispatch (`workflow_dispatch`)
- Changes to docs or the clean-room scripts
