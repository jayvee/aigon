# Aigon Clean-Room Test Environment

Validates Aigon's installation and getting-started docs end-to-end from a fresh machine. Two modes:

- **Manual mode** — interactive shell on a clean OS; step through the flow as a new user
- **Automated mode** — non-interactive smoke test; exits non-zero on any failure

## Prerequisites (macOS host)

- OrbStack (provides the Docker daemon): `brew install orbstack`
- Open OrbStack at least once to complete setup
- OrbStack should be set to **start at login** (Preferences → General) so Docker is always available

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

Drops you into a bash shell on a minimal Ubuntu 24.04 container. No Node.js, git, tmux, or aigon are pre-installed — you start from zero. User is `dev` with passwordless sudo.

The aigon source is bind-mounted at `~/src/aigon`. Follow the steps below:

### Step 1: Install system prerequisites

```bash
# Node.js 22 from NodeSource (Ubuntu's nodejs package pulls in 650+ deps)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs git tmux lsof
```

Set up git identity and GitHub auth:

```bash
git config --global user.name "Dev User"
git config --global user.email "dev@example.com"
git config --global init.defaultBranch main

# Install GitHub CLI
(type -p wget >/dev/null || sudo apt-get install wget -y) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt-get update && sudo apt-get install gh -y

# Log in — this also configures git credentials for GitHub
gh auth login
```

> **Note:** `gh auth login` will print a device code URL. Open it in your Mac browser, enter the code, and approve.

### Step 2: Install agent CLIs

```bash
sudo npm i -g @anthropic-ai/claude-code
sudo npm i -g @google/gemini-cli
```

Verify and authenticate:

```bash
mkdir -p ~/.gemini   # workaround: Gemini CLI bug on first run

claude --version
gemini --version
```

**Authenticate each CLI before continuing:**

```bash
# Claude Code — run once to log in
claude
# Follow the prompts (opens a browser URL — copy to your Mac browser, approve, paste code back)
# Exit with /exit once authenticated

# Gemini — run once to log in
gemini
# Prints an OAuth URL — copy to your Mac browser, authenticate with Google, paste code back
# Exit with Ctrl+C or /exit once authenticated
```

Alternatively, skip interactive auth by setting API keys: `ANTHROPIC_API_KEY` for Claude, `GOOGLE_API_KEY` for Gemini.

### Step 3: Install aigon

```bash
cd ~/src/aigon && npm install && sudo npm link
aigon --version
```

### Step 3b: Install Aigon Pro

Aigon Pro is automatically bind-mounted at `~/src/aigon-pro` if it exists on your Mac at `~/src/aigon-pro`.

```bash
cd ~/src/aigon-pro
npm install
sudo npm link
cd ~/src/aigon
sudo npm link @aigon/pro
```

> **Note:** If `~/src/aigon-pro` doesn't exist in the container, you need to clone it on your Mac first: `git clone https://github.com/jayvee/aigon-pro.git ~/src/aigon-pro`, then restart the container.

### Step 4: Clone a test repo (simulates someone's existing project)

### Step 4: Clone a test repo (simulates someone's existing project)

```bash
git clone https://github.com/jayvee/brewboard-seed.git ~/src/brewboard
cd ~/src/brewboard
npm install
```

### Step 5: Install aigon into the repo

```bash
aigon init
aigon install-agent cc gg
```

Verify:

```bash
aigon board
aigon doctor
```

### Step 6: Start the aigon server

```bash
nohup aigon server start > /dev/null 2>&1 &
aigon server add ~/src/brewboard
```

Then open http://localhost:4100 on your Mac browser.

> **Note:** Use `nohup` to prevent the server from getting suspended by shell job control in Docker.

### Step 7: Open the dashboard

Open http://localhost:4100 on your Mac browser. Verify brewboard appears in the Pipeline view.

### Step 8: Run a feature with Gemini

From inside the container (`cd ~/src/brewboard`):

```bash
# Start a feature with Gemini
aigon feature-start 02 gg

# Attach to watch the agent work (Ctrl+B D to detach)
tmux attach -t brewboard-f2-do-gg-brewery-import

# Check status on dashboard or CLI
aigon board

# After agent submits, close the feature
aigon feature-close 02
```

### Step 9: Run a feature with Claude Code

```bash
# Start a different feature with Claude Code
aigon feature-start 03 cc

# Attach to watch (Ctrl+B D to detach)
tmux attach -t brewboard-f3-do-cc-*

# Check status
aigon board

# After agent submits, close the feature
aigon feature-close 03
```

### Step 10: Run a research topic

```bash
# Create and start research
aigon research-create "evaluate auth libraries"
aigon research-prioritise "evaluate auth libraries"
aigon board   # note the research ID
aigon research-start <ID> gg

# After agent submits findings
aigon research-eval <ID>
aigon research-close <ID>
```

> **Note:** Features and research require API keys (`GOOGLE_API_KEY` for Gemini, `ANTHROPIC_API_KEY` for Claude).
> Pass them via environment variables when launching the container, or export them inside the shell.

### Verification checklist

- [ ] Node, git, tmux installed
- [ ] `claude --version` prints a version
- [ ] `gemini --version` prints a version (after `mkdir -p ~/.gemini`)
- [ ] `aigon --version` prints a version
- [ ] `aigon init` rebuilt manifests for seed features
- [ ] `aigon install-agent cc gg` wrote configs for both agents
- [ ] `aigon board` shows seeded features
- [ ] `aigon doctor` shows green checks for Node, git, tmux
- [ ] Dashboard responds at localhost:4100 with brewboard visible

Ports forwarded to the host:
- **4100** — Aigon dashboard
- **3000** — Dev server (e.g., brewboard)

## Automated Mode (Smoke Test)

Runs `smoke-test.sh` inside the container. Each scenario follows the real getting-started flow.

### Scenarios

| # | Name | What it tests |
|---|------|---------------|
| 1 | Full install | Prerequisites → agent CLIs → aigon → brewboard clone → init → install-agent → board → doctor |
| 2 | Full install + server | Scenario 1 + aigon server start + dashboard HTTP check |

```bash
# Run one scenario
docker/clean-room/run.sh --auto --scenario 1

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

- Running actual agent sessions (requires API keys + agent CLI auth)
- Full feature lifecycle (feature-start, feature-do, feature-close)
- Dashboard UI verification beyond HTTP response
- Windows

## macOS CI

The GitHub Actions workflow at `.github/workflows/clean-room-macos.yml` runs the smoke test on `macos-latest`. It triggers on:
- Manual dispatch (`workflow_dispatch`)
- Changes to docs or the clean-room scripts

## Teardown

The container is created with `--rm`, so exiting the shell destroys it. To start fresh, just run `docker/clean-room/run.sh` again.

## Known Issues

| Issue | Workaround |
|-------|-----------|
| `npm i -g` needs sudo | Always use `sudo` for global installs on Linux |
| Gemini CLI fails if `~/.gemini/` doesn't exist | `mkdir -p ~/.gemini` before first `gemini` command — this is a Gemini CLI bug |
| Dashboard "View" button can't open tmux | Use `docker exec -it <container> tmux attach -t <session>` from Mac |
| `aigon server start &` gets suspended | Use `nohup aigon server start > /dev/null 2>&1 &` |
