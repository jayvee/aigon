# Aigon Clean-Room Test Environment

Validates Aigon's installation and getting-started docs end-to-end from a fresh Linux machine. Two modes:

- **Manual mode** — interactive shell on a clean Ubuntu container; step through the flow as a new user
- **Automated mode** — unattended smoke test; exits non-zero on any failure

## Unattended end-to-end

`docker/clean-room/run-e2e.sh` is a host-side orchestrator that runs the full install test without human input. One command validates every install change before release. Your Claude Code credentials (`~/.claude.json`, `~/.claude/settings.json`) are injected automatically — no API key needed.

```bash
bash docker/clean-room/run-e2e.sh
```

The script exits 0 on success and non-zero with a stage-tagged error on any must-pass failure. Container logs are always written to `docker/clean-room/last-run.log` before teardown.

### Expected runtime

| Phase | Time |
|-------|------|
| Must-pass core (preflight → build → install → dashboard) | ~10–15 min |
| Best-effort feature run (autonomous agent) | +~5–15 min |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AIGON_E2E_SKIP_FEATURE_RUN` | `0` | Set to `1` to skip the autonomous feature run. |
| `AIGON_E2E_FEATURE_ID` | auto | Override the brewboard feature ID used in the run. |
| `AIGON_E2E_STOP_AFTER` | `300` | Seconds before the host kills the agent session. |
| `ANTHROPIC_API_KEY` | — | Optional. Required only for the autonomous feature run in Stage 6. Subscription auth (via injected `~/.claude.json`) is enough for the core install test. |

---

## Manual mode

### Step 0: Launch the container

Run from the aigon repo root (`~/src/aigon`):

```bash
cd ~/src/aigon
docker build -t aigon-clean-room docker/clean-room/
docker run --rm -it -v ~/src/aigon:/home/dev/src/aigon -p 4102:4100 --hostname clean-room aigon-clean-room bash
```

You are now `dev` inside Ubuntu 24.04. Nothing is pre-installed.

### Step 1: Inject your credentials (from a second terminal on your Mac)

```bash
bash scripts/docker-inject-creds.sh $(docker ps -qf ancestor=aigon-clean-room)
```

This copies `~/.claude.json`, `~/.claude/settings.json`, Gemini, Codex, and GitHub CLI credentials into the container. Skip anything you don't have.

### Step 2: Install system prerequisites

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs git tmux lsof build-essential python3
```

### Step 3: Install Aigon from npm

```bash
sudo npm install -g @senlabsai/aigon@next
aigon --version
```

Or to test from local source instead:

```bash
cd ~/src/aigon && npm ci --ignore-scripts && sudo npm link
```

### Step 4: Clone the test repo

```bash
git clone https://github.com/jayvee/brewboard-seed.git ~/src/brewboard && cd ~/src/brewboard && npm install
```

### Step 5: Initialise Aigon in the repo

```bash
aigon init && aigon install-agent cc gg && aigon board && aigon doctor
```

### Step 6: Start the server and open the dashboard

```bash
nohup aigon server start > /dev/null 2>&1 & sleep 2 && aigon server add ~/src/brewboard
```

Open **http://localhost:4102** in your Mac browser (note: host port 4102 maps to container 4100).

### Verification checklist

- [ ] `node --version` prints 18+
- [ ] `aigon --version` prints a version
- [ ] `aigon board` shows seeded brewboard features
- [ ] `aigon doctor` passes Node, git, tmux checks
- [ ] Dashboard at localhost:4102 shows brewboard in the Pipeline view

---

## Testing Aigon Pro before publishing

Run this **before** `npm publish` on aigon-pro. Uses local tarballs — nothing hits the registry.

### Step 1 — Build both tarballs (on your Mac, outside Docker)

```bash
# aigon repo
cd ~/src/aigon && npm pack
# → senlabsai-aigon-<version>.tgz

# aigon-pro repo (prepublishOnly runs esbuild build + obfuscation gate automatically)
cd ~/src/aigon-pro && npm pack
# → senlabsai-aigon-pro-<version>.tgz
```

### Step 2 — Launch the container with both repos mounted

Run from the aigon repo root (`~/src/aigon`):

```bash
cd ~/src/aigon
docker build -t aigon-clean-room docker/clean-room/
docker run --rm -it \
  -v ~/src/aigon:/home/dev/src/aigon \
  -v ~/src/aigon-pro:/home/dev/src/aigon-pro \
  -p 4102:4100 \
  --hostname clean-room \
  aigon-clean-room bash
```

### Step 3 — Run Scenario 3 (automated)

```bash
AIGON_PRO_KEY=***REDACTED*** bash ~/src/aigon/docker/clean-room/smoke-test.sh --scenario 3
```

Checks: aigon installs, aigon-pro installs from tarball, key activates, `aigon pro status` shows both green.

### Step 4 — Manual checks

```bash
aigon pro status                   # Package ✅  Key ✅  Pro is active
aigon insights | head -3           # should return data, not a gate message
aigon pro activate wrongkey
aigon insights 2>&1 | head -3      # should show: 🔒 ... is a Pro feature.
aigon pro activate ***REDACTED***   # restore correct key
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `AIGON_PRO_KEY` | — | Beta activation key. Required for key + activation checks. |
| `AIGON_PRO_TGZ` | auto-detect | Path to tarball. Auto-detected from `~/src/aigon-pro/senlabsai-aigon-pro-*.tgz`. |

---

## Opening a second shell into a running container

```bash
docker exec -it $(docker ps -qf ancestor=aigon-clean-room) bash
```

---

## Known issues

| Issue | Workaround |
|-------|-----------|
| `npm i -g` needs sudo on Linux | Always prefix with `sudo` inside the container |
| Gemini CLI fails if `~/.gemini/` doesn't exist | `mkdir -p ~/.gemini` before first `gemini` run |
| `aigon server start &` gets suspended by job control | Use `nohup aigon server start > /dev/null 2>&1 &` |
| Dashboard port | Host port **4102** maps to container 4100 (4100 may be in use on your Mac) |
