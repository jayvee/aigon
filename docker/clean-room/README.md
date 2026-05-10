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

This is a single linear flow. Run **every** command in order — don't skip ahead, don't substitute. Each block is copy-paste ready.

### Step 1: Pack the current source (on your Mac, before launching the container)

```bash
cd ~/src/aigon
rm -f senlabsai-aigon-*.tgz
npm pack
```

You should see `senlabsai-aigon-<version>.tgz` in the repo root. This is what the container will install — so it contains every uncommitted change in your working tree at pack time.

> **Why this and not `npm install -g @senlabsai/aigon@next`?** Installing from `@next` would test the *published* version, not the changes you just made. Always pack locally for testing.

### Step 2: Build the container image and launch (on your Mac)

```bash
cd ~/src/aigon
docker build -t aigon-clean-room docker/clean-room/
docker run --rm -it \
  -v ~/src/aigon:/home/dev/src/aigon \
  -p 4102:4100 \
  --hostname clean-room \
  aigon-clean-room bash
```

You are now `dev` inside Ubuntu 24.04 with nothing pre-installed. Every command from here on runs **inside the container** until you `exit`.

### Step 3: Install system prerequisites

```bash
sudo apt-get update -qq
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  nodejs git tmux lsof build-essential python3
```

### Step 4: Install Aigon from the packed tarball

```bash
TGZ=$(ls /home/dev/src/aigon/senlabsai-aigon-*.tgz | head -1)
sudo npm install -g "$TGZ"
aigon --version
```

`aigon --version` should print whatever version is in `package.json` on your Mac.

### Step 5: Clone the demo repo

```bash
git clone https://github.com/jayvee/brewboard-seed.git ~/src/brewboard
cd ~/src/brewboard
npm install
```

### Step 6: Bring Aigon into the repo

```bash
aigon apply
aigon install-agent cc gg
aigon board
aigon doctor
```

`aigon apply` bootstraps `.aigon/`, the kanban folder layout, hooks, and the workflow engine on first run — and refreshes templates thereafter. `install-agent cc gg` writes Claude Code and Gemini slash commands and configs (no login required to test the install path).

### Step 7: Start the server and open the dashboard

```bash
nohup aigon server start > ~/server.log 2>&1 &
sleep 3
aigon server add ~/src/brewboard
```

Open **http://localhost:4102** in your Mac browser. The host port 4102 maps to port 4100 inside the container.

### Step 8: Verify

Tick these off in the container shell + browser:

- [ ] `node --version` prints v22.x
- [ ] `aigon --version` prints your local source version
- [ ] `aigon board` shows seeded brewboard features
- [ ] `aigon doctor` reports green for Node, git, tmux
- [ ] Dashboard at `http://localhost:4102` loads and shows `brewboard` in the Pipeline view

### Step 9: Tear down

Type `exit` in the container. The container is `--rm` so it cleans itself up automatically — nothing on your Mac is mutated.

---

## Optional: inject your real agent credentials

**Skip this section unless** you specifically want to also test that the agent CLIs can talk to Anthropic/Google with your real account — e.g. for running an actual feature autonomously inside the container. The install / apply / remove / dashboard flow above does **not** need it.

After Step 2 (container is running) and **from a second terminal on your Mac**:

```bash
cd ~/src/aigon
bash scripts/docker-inject-creds.sh $(docker ps -qf ancestor=aigon-clean-room)
```

This copies `~/.claude.json`, `~/.claude/settings.json`, Gemini, Codex, and GitHub CLI credentials into the container. Skip silently for anything you don't have configured on your Mac.

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
