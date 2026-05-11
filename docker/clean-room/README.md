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

You are testing the **new-user experience**: install Aigon, run `aigon setup`, and let the wizard drive the rest. The whole point is to exercise the wizard end-to-end, not to reinvent what it does.

Run every block in order. Each is copy-paste ready.

### Step 1 — Pack the current source (on your Mac)

```bash
cd ~/src/aigon
rm -f senlabsai-aigon-*.tgz
npm pack
```

This produces `senlabsai-aigon-<version>.tgz` in the repo root. The container installs from this tarball, so every uncommitted change you have locally is what gets tested.

> Why not `npm install -g @senlabsai/aigon@next`? That installs the *published* package, not your local changes. Always pack locally.

### Step 2 — Launch the container (on your Mac)

```bash
docker run --rm -it \
  -v ~/src/aigon:/home/dev/src/aigon \
  -p 4102:4100 \
  --hostname clean-room \
  aigon-clean-room bash
```

You're now at `dev@clean-room:~$` inside Ubuntu 24.04 — nothing pre-installed. Every command from here runs **inside the container** until you `exit`.

### Step 3 — Install the bare minimum for Aigon to run

The wizard verifies Node and Git; it doesn't install them itself. Install them first:

```bash
sudo apt-get update -qq
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs git build-essential python3 lsof tmux
```

### Step 4 — Install Aigon from your packed tarball

```bash
TGZ=$(ls /home/dev/src/aigon/senlabsai-aigon-*.tgz | head -1)
sudo npm install -g "$TGZ"
aigon --version
```

### Step 5 — Run the setup wizard

**This is the actual test.** Everything from here is `aigon setup` doing its job — driving the new-user flow.

```bash
aigon setup
```

The wizard walks you through 8 steps. Adapt to the Linux container as follows:

| Wizard step | What to answer |
|---|---|
| 1. Prerequisites | Accept offers to install `tmux` and `gh`. The wizard will prompt for git identity if not set — give it any name / email. |
| 2. Terminal preference | macOS-only — should be skipped automatically on Linux. |
| 3. Agent install | Multi-select. Pick `cc gg` (Claude Code + Gemini). The wizard installs the npm CLIs; **skip the auth flows** — you're testing install, not login. If the auth prompt blocks, hit Ctrl-C on just that sub-prompt; the wizard continues. |
| 4. Optional seed clone | **Say yes.** This clones brewboard-seed, runs `aigon apply` inside it, and registers it. This is the real apply + bootstrap test. |
| 5. Repo scan | Decline (no extra repos in `~/src` to register). |
| 6. Dashboard server | **Say yes — start it.** |
| 7. Brewboard demo | **Decline** — the demo runs an actual autonomous agent, which needs real credentials. Run it later if you've injected creds (see Optional section below). |
| 8. Aigon Pro vault | Decline. |

When the wizard finishes you have a fully set-up container.

### Step 6 — Verify the result

```bash
aigon --version            # your local source version
aigon doctor               # green for node, git, tmux; reports the registered brewboard
aigon board                # shows seeded brewboard features
ls ~/src/brewboard/.aigon  # apply wrote applied-digest, version, install-manifest, config
```

Then open **http://localhost:4102** in your Mac browser — the dashboard should load and show `brewboard` in the Pipeline view.

### Step 7 — Tear down

Type `exit` in the container. The `--rm` flag means it cleans itself up — nothing on your Mac is touched.

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
