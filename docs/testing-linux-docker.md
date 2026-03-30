# Testing Aigon on Linux via Docker

Internal reference for running end-to-end install/workflow tests on Linux using Docker (OrbStack).

## Prerequisites (macOS host)

- OrbStack or Docker Desktop: `brew install orbstack`
- Open OrbStack once to complete setup

## Build and start the container

```bash
# From the aigon repo root
docker compose -f docker-compose.linux-test.yml build
docker compose -f docker-compose.linux-test.yml up -d
```

This creates an Ubuntu 24.04 container with Node 22, Git, tmux, and a non-root `dev` user (password: `dev`).

**Exposed ports:**
- 4100-4210: aigon server + dev servers
- 3000-3010: default dev server ports

## Shell into the container

```bash
docker exec -it aigon-linux bash
```

## Full install test (as a new user)

Run all commands inside the container (`docker exec -it aigon-linux bash`).

### Step 1: Clone and install aigon

```bash
git clone https://github.com/jayvee/aigon.git ~/src/aigon
cd ~/src/aigon
npm install
sudo npm link
```

**Expect:** No errors. `npm link` creates the global `aigon` command.

### Step 2: Verify installation

```bash
aigon --version    # prints version number (e.g., 2.50.20)
aigon doctor       # shows Prerequisites section with green checkmarks for Node, Git, tmux
```

**Expect:** Version prints. Doctor shows ✅ for Node.js, git, tmux. Agent CLIs show "not installed" (that's fine).

### Step 3: Install an agent CLI

```bash
sudo npm i -g @google/gemini-cli
gemini
```

**Expect:** Gemini CLI prompts for auth. It prints an OAuth URL — copy it, open in your Mac browser, authenticate with Google, paste the authorization code back. Once authenticated, exit Gemini with `Ctrl+C` or `/exit`.

### Step 4: Clone seed repo and set up

```bash
git clone https://github.com/jayvee/brewboard-seed.git ~/src/brewboard
cd ~/src/brewboard
npm install
aigon init
aigon install-agent gg
```

**Expect:**
- `npm install` — installs brewboard's dependencies (Next.js, etc.)
- `aigon init` — prints "✅ ./docs/specs directory structure created" and "Rebuilt 7 manifest(s) for existing features"
- `aigon install-agent gg` — prints "✅ Commands: 12 updated" and "Installed Aigon for: Gemini"

### Step 5: Start a feature

```bash
aigon feature-start 02 gg
```

**Expect:** Spec moves to in-progress, worktree created, tmux session created. On Linux you'll see:
- `⚠️ Terminal "warp" is not supported on Linux. Falling back to tmux.`
- `📋 No GUI terminal found. Run this command manually:`
- `tmux attach -t brewboard-f2-gg-brewery-import`

This is correct — Linux headless mode prints the attach command instead of opening a terminal app.

### Step 6: Watch the agent work

```bash
tmux attach -t brewboard-f2-gg-brewery-import
```

**Expect:** Gemini CLI running, reading the spec, implementing code. Use `Ctrl+B D` to detach without killing the session.

**From Mac terminal** (alternative): `docker exec -it aigon-linux tmux attach -t brewboard-f2-gg-brewery-import`

### Step 7: Start the dashboard

**Important:** Use `nohup` to prevent the dashboard from getting suspended by shell job control.

```bash
nohup aigon server start > /dev/null 2>&1 &
aigon dashboard add ~/src/brewboard
```

Then open http://localhost:4100 on your Mac browser.

**Expect:** Dashboard shows brewboard in the Pipeline view with feature #02 in-progress and Gemini agent status (Running or Submitted).

### Step 8: Close the feature

After the agent shows "Submitted" (visible in dashboard or via `aigon board`):

**Option A — from CLI:**
```bash
aigon feature-close 02
```

**Option B — from dashboard:**
Click "Accept & Close" button on the feature card.

**Expect:** Feature merges to main, spec moves to `05-done/`, worktree cleaned up, tmux session killed.

### Verification checklist

After completing all steps, confirm:

- [ ] `aigon --version` printed a version
- [ ] `aigon doctor` showed green checks for Node, Git, tmux
- [ ] Gemini CLI authenticated successfully
- [ ] `aigon init` rebuilt manifests for seed features
- [ ] `aigon install-agent gg` warned if CLI missing, wrote configs
- [ ] `aigon feature-start` created worktree and tmux session (no osascript/iTerm2 errors)
- [ ] Warp fallback to tmux printed correctly (no "Terminal.app" in messages)
- [ ] Agent ran and implemented the feature
- [ ] Dashboard rendered at localhost:4100 with feature visible
- [ ] Feature close worked (CLI or dashboard button)
- [ ] `ls docs/specs/features/05-done/` shows the closed feature

## Viewing from macOS

| What | How |
|------|-----|
| Dashboard | http://localhost:4100 in Mac browser |
| Dev server | http://localhost:4202 (or whichever port) in Mac browser |
| Tmux session | `docker exec -it aigon-linux tmux attach -t <session>` |
| Container shell | `docker exec -it aigon-linux bash` |

## Gemini auth in Docker

Gemini CLI can't open a browser inside the container. When you run `gemini`, it prints an OAuth URL. Copy it, open on your Mac, authenticate, paste the authorization code back. Alternatively, use an API key from https://aistudio.google.com/app/apikey.

## Known issues and workarounds

| Issue | Workaround |
|-------|-----------|
| `npm i -g` needs sudo | Always use `sudo` for global installs on Linux |
| Gemini trust dialog on worktrees | Fixed in aigon (pre-seeds `~/.gemini/trustedFolders.json`) |
| Dashboard "View" button can't open tmux | Use `docker exec -it aigon-linux tmux attach -t <session>` from Mac |
| Dev server ports not accessible | Restart container after updating docker-compose port mapping |
| `aigon server start &` gets suspended | Use `nohup aigon server start > /dev/null 2>&1 &` or `docker exec -d` |
| Chrome not available on arm64 Linux | Use Playwright's bundled Chromium for headless testing |

## Teardown

```bash
# Stop container (preserves state)
docker compose -f docker-compose.linux-test.yml stop

# Restart
docker compose -f docker-compose.linux-test.yml start

# Destroy completely
docker compose -f docker-compose.linux-test.yml down
```

## Rebuilding after aigon changes

Push changes to GitHub, then inside the container:

```bash
cd ~/src/aigon
git pull
sudo npm link
```

No need to rebuild the Docker image — aigon is cloned inside the container.
