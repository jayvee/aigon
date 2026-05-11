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

**You are testing the public install flow end-to-end** — exactly what a new customer would do. This README does Docker-specific container setup; **the actual install steps come from the published [Getting Started docs](https://aigon.build/docs/getting-started)**. If the public docs are wrong, this test catches it.

### Container-only steps (no public-doc equivalent)

#### Pack the current source (on your Mac, before launching)

The container installs from your local tarball so your in-tree changes get tested:

```bash
cd ~/src/aigon
rm -f senlabsai-aigon-*.tgz
npm pack
```

#### Launch the container (on your Mac)

```bash
docker run --rm -it \
  -v ~/src/aigon:/home/dev/src/aigon \
  -p 4102:4100 \
  --hostname clean-room \
  aigon-clean-room bash
```

You're now at `dev@clean-room:~$` inside Ubuntu 24.04 with nothing pre-installed.

### The install — follow the public docs

Open **<https://aigon.build/docs/getting-started>** and follow the **Ubuntu / Debian** row of the Prerequisites table, then the **Quick install** section. **The only deviation: replace the `npm install` line with the tarball install** so you're testing your local source instead of the published package:

```bash
# Use INSTEAD OF `npm install -g @senlabsai/aigon@next` from the public docs
TGZ=$(ls /home/dev/src/aigon/senlabsai-aigon-*.tgz | head -1)
sudo npm install -g "$TGZ"
```

Then continue with `aigon setup` exactly as the public docs describe.

### What to answer in the wizard (Linux container quirks)

The public docs describe each step. In the container specifically:

- **Step 2 (Terminal preference)** — macOS-only, auto-skips on Linux.
- **Step 3 (Agent install)** — pick `cc gg`. Skip the auth flows when prompted (Ctrl-C the sub-prompt) — you're testing install, not login.
- **Step 4 (Seed clone)** — say yes.
- **Step 5 (Repo scan)** — decline.
- **Step 6 (Dashboard server)** — say yes.
- **Step 7 (Brewboard demo)** — decline unless you've injected credentials (see [Optional](#optional-inject-your-real-agent-credentials) below).
- **Step 8 (Aigon Pro vault)** — decline.

### Verify

In the container shell:

```bash
aigon doctor
aigon board
```

Then open **<http://localhost:4102>** in your Mac browser (host port 4102 maps to container port 4100). The dashboard should load and show `brewboard` in the Pipeline view.

### Tear down

Type `exit`. The `--rm` flag cleans the container up automatically.

### When the public docs are wrong

If any step in the public docs causes a failure inside this container (missing package, wrong command, ambiguous wording), **the bug is in the public docs, not in this README**. Fix `site/content/getting-started.mdx` and re-run — never patch this file with workarounds.

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
