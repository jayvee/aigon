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
- 4100-4210: dashboard + dev servers
- 3000-3010: default dev server ports

## Shell into the container

```bash
docker exec -it aigon-linux bash
```

## Full install test (as a new user)

```bash
# 1. Clone and install aigon
git clone https://github.com/jayvee/aigon.git ~/src/aigon
cd ~/src/aigon
npm install
sudo npm link

# 2. Verify
aigon --version
aigon doctor

# 3. Install an agent CLI
sudo npm i -g @google/gemini-cli
gemini    # authenticate — prints OAuth URL, open on Mac, paste code back

# 4. Clone seed repo and set up
git clone https://github.com/jayvee/brewboard-seed.git ~/src/brewboard
cd ~/src/brewboard
npm install
aigon init
aigon install-agent gg

# 5. Start a feature
aigon feature-start 02 gg

# 6. Attach to the agent session
tmux attach -t brewboard-f2-gg-brewery-import
# (Ctrl+B D to detach)

# 7. Start dashboard
aigon dashboard &
aigon dashboard add ~/src/brewboard
# Open http://localhost:4100 on Mac browser

# 8. Close the feature (after agent submits)
aigon feature-close 02
```

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
| `aigon dashboard &` gets suspended | Use `nohup aigon dashboard > /dev/null 2>&1 &` or `docker exec -d` |
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
