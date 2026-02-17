# Aigon: Detailed Workflows & Configuration

**Comprehensive reference for detailed workflows, advanced configuration, and best practices.**

For a quick overview and getting started, see the main [README.md](../README.md).

---

## Table of Contents

1. [Detailed Feature Lifecycle](#detailed-feature-lifecycle)
2. [Detailed Research Lifecycle](#detailed-research-lifecycle)
3. [Hooks Deep Dive](#hooks-deep-dive)
4. [Project Profiles](#project-profiles)
5. [Local Dev Proxy](#local-dev-proxy)
6. [Opening Worktrees](#opening-worktrees)
7. [Configuration](#configuration)
8. [Multi-Agent Evaluation Examples](#multi-agent-evaluation-examples)
9. [Contributing / Developing Aigon](#contributing--developing-aigon)

---

## Detailed Feature Lifecycle

### Fast-Track (Solo Branch)

For features where you want to go from idea to implementation immediately:

* **Now:** `/aigon:feature-now dark-mode` (or `aigon feature-now dark-mode`) — if `dark-mode` matches an existing feature in the inbox, it runs prioritise → setup → implement. Otherwise it creates a new spec directly in `/in-progress`, assigns an ID, creates a solo branch, and commits atomically. Either way, you go from name to implementation in one session.
* **Implement:** `/aigon:feature-implement <ID>` (or `/aigon-feature-implement <ID>` for Cursor, `/prompts:aigon-feature-implement <ID>` for Codex) to implement the feature.
* **Done:** `/aigon:feature-done <ID>` (or `aigon feature-done <ID>`) merges and completes.

This skips the inbox/backlog/setup steps entirely. Use the slash command for the full guided experience.

### Solo Mode (Single Agent)

Solo mode supports two workspace styles: **branch** (work in the current repo) or **worktree** (isolated directory for parallel development).

1.  **Create:** `/aigon:feature-create "Dark Mode"` (or `aigon feature-create "Dark Mode"`) creates a templated spec in `/inbox`.
    * The agent **explores the codebase** before writing the spec to understand existing architecture, patterns, and constraints.
2.  **Prioritise:** `/aigon:feature-prioritise dark-mode` (or `aigon feature-prioritise dark-mode`) assigns an ID and moves to `/backlog`.
3.  **Setup:**
    * **Branch mode:** `/aigon:feature-setup 108` (or `aigon feature-setup 108`) — creates a Git branch (`feature-108-dark-mode`) in the current repo.
    * **Worktree mode:** `/aigon:feature-setup 108 cc` (or `aigon feature-setup 108 cc`) — creates an isolated worktree at `../<repo>-worktrees/feature-108-cc-dark-mode`, ideal for working on multiple features in parallel.
    * Both modes auto-create a blank Implementation Log template.
4.  **Implement:** `/aigon:feature-implement 108` (or `/aigon-feature-implement 108` for Cursor, `/prompts:aigon-feature-implement 108` for Codex).
    * Agent reads the feature spec and creates **tasks from the acceptance criteria** for progress tracking.
    * Agent codes the solution and *must* fill out the Implementation Log.
5.  **Evaluate (Optional):** `/aigon:feature-eval 108` (or `aigon feature-eval 108`)
    * Creates code review checklist for the implementation.
6.  **Cross-Agent Review (Optional):** Have a different agent review the code and commit fixes:
    * Open a session with a different agent (e.g., Codex if Claude implemented)
    * `/aigon:feature-review 108` (or `/aigon-feature-review 108` for Cursor, `/prompts:aigon-feature-review 108` for Codex)
    * The reviewing agent reads the spec, reviews `git diff main...HEAD`, and commits targeted fixes with `fix(review):` prefix
    * Review the fix commits before proceeding
7.  **Finish:** `/aigon:feature-done 108` (or `aigon feature-done 108`)
    * Merges the branch and archives the log.
    * For solo worktree mode, the agent is auto-detected — no need to specify it.

### Arena Mode (Multi-Agent Competition)

Run multiple agents in competition to find the optimal solution.

1.  **Create:** `/aigon:feature-create "Dark Mode"` (or `aigon feature-create "Dark Mode"`) creates a templated spec in `/inbox`.
    * The agent **explores the codebase** before writing the spec.
2.  **Prioritise:** `/aigon:feature-prioritise dark-mode` (or `aigon feature-prioritise dark-mode`) assigns an ID and moves to `/backlog`.
3.  **Setup Arena:** `/aigon:feature-setup 108 cc gg cx` (or `aigon feature-setup 108 cc gg cx`)
    * Moves Spec to `/03-in-progress`.
    * Creates agent-specific **Git Branches** (`feature-108-cc-dark-mode`, `feature-108-gg-dark-mode`, `feature-108-cx-dark-mode`).
    * Creates **Git Worktrees** in a grouped folder:
        * `../<repo>-worktrees/feature-108-cc-dark-mode` (Claude)
        * `../<repo>-worktrees/feature-108-gg-dark-mode` (Gemini)
        * `../<repo>-worktrees/feature-108-cx-dark-mode` (Codex)
    * **Auto-creates** blank Implementation Log templates in each worktree.
    * **STOPS** - does not implement (user must open each worktree separately).
4.  **Implement:** Open all worktrees side-by-side with `/aigon:worktree-open 108 --all` (or `aigon worktree-open 108 --all`), or individually with `/aigon:worktree-open 108 cc` (or `aigon worktree-open 108 cc`).
    * With Warp: Opens all agents side-by-side and auto-starts each with `/aigon:feature-implement 108`.
    * Single agent: Opens one worktree with agent CLI pre-loaded.
    * With VS Code: Opens the folder; run `/aigon:feature-implement 108` manually.
    * Each agent builds the feature independently in their isolated worktree.
    * Each agent creates **tasks from the acceptance criteria** and *must* fill out their Implementation Log.
5.  **Cross-Agent Review (Optional):** Before evaluation, have different agents review each implementation:
    * In each worktree, open a session with a different agent
    * `/aigon:feature-review 108` (or `/aigon-feature-review 108` for Cursor, `/prompts:aigon-feature-review 108` for Codex)
    * Reviewing agent commits fixes with `fix(review):` prefix
6.  **Evaluate:** Back in the main folder, switch to an eval model (eg sonnet) and run `/aigon:feature-eval 108` (or `aigon feature-eval 108`)
    * Moves the feature to `/in-evaluation`.
    * Creates comparison template with all implementations.
7.  **Judge:** Review and compare solutions, fill in the evaluation.
8.  **Merge Winner:**
    ```bash
    /aigon:feature-done 108 cc
    # or: aigon feature-done 108 cc
    ```
    * Merges winner's branch.
    * Moves winning agent's log to `logs/selected`.
    * Moves losing agent's logs to `logs/alternatives` (preserving history).
    * Cleans up winner's worktree.
9.  **Cleanup Losers:**
    ```bash
    /aigon:feature-cleanup 108 [--push]
    # or: aigon feature-cleanup 108 [--push]
    ```
    * Removes losing worktrees and branches.
    * Optional `--push` flag pushes branches to origin before deleting.

---

## Detailed Research Lifecycle

### Solo Mode (Single Agent)

* **Create:** `/aigon:research-create "API Design"` (or `aigon research-create "API Design"`) creates a templated topic in `/01-inbox`. The agent **explores the codebase** before writing the topic to understand relevant existing code and constraints.
* **Prioritise:** `/aigon:research-prioritise api-design` (or `aigon research-prioritise api-design`) moves it to `/02-backlog` and assigns a global ID.
* **Setup:** `/aigon:research-setup 05` (or `aigon research-setup 05`) moves to `/03-in-progress`.
* **Execute:** `/aigon:research-conduct 05` (or `/aigon-research-conduct 05` for Cursor, `/prompts:aigon-research-conduct 05` for Codex). Agent reads the topic file, writes findings and recommendations directly into the document.
* **Done:** `/aigon:research-done 05` (or `aigon research-done 05`) moves to `/04-done`.
* **Output:** The research file becomes a complete record, with suggested features in the Output section.

### Arena Mode (Multi-Agent Research)

Run multiple agents to get diverse perspectives on a research topic.

* **Create:** `/aigon:research-create "API Design"` (or `aigon research-create "API Design"`) creates a templated topic in `/01-inbox`. The agent **explores the codebase** first.
* **Prioritise:** `/aigon:research-prioritise api-design` (or `aigon research-prioritise api-design`) moves it to `/02-backlog` and assigns a global ID.
* **Setup Arena:** `/aigon:research-setup 05 cc gg cx` (or `aigon research-setup 05 cc gg cx`)
    * Moves topic to `/03-in-progress`.
    * Creates **separate findings files** for each agent in `logs/`:
        * `research-05-cc-findings.md` (Claude)
        * `research-05-gg-findings.md` (Gemini)
        * `research-05-cx-findings.md` (Codex)
* **Execute:** Open all agents side-by-side with `/aigon:research-open 05` (or `aigon research-open 05`), then run `/aigon:research-conduct 05` in each agent session.
    * Each agent writes ONLY to their own findings file.
    * Agents must NOT run `research-done` (user handles synthesis).
* **Synthesize:** `/aigon:research-synthesize 05` (or `/aigon-research-synthesize 05` for Cursor, `/prompts:aigon-research-synthesize 05` for Codex) with an agent to:
    * Read and compare ALL agents' findings
    * Present a synthesis with recommendations
    * Ask you which features to include (via chat)
    * Update the main research doc with your selections
    * **Tip:** Use a different model than those that conducted the research for unbiased synthesis
* **Complete:** `/aigon:research-done 05 --complete` (or `aigon research-done 05 --complete`) moves to `/04-done`.
* **Output:** The main research file contains the synthesized recommendation, with findings files preserved in `logs/`.

---

## Hooks Deep Dive

Hooks allow you to run custom scripts before and after Aigon commands. This is useful for integrating with your specific infrastructure (databases, deployment platforms, etc.) without modifying the core Aigon commands.

### Hooks File

Define hooks in `docs/aigon-hooks.md`. Aigon automatically detects and runs hooks based on heading names.

### Hooks Format

```markdown
# Aigon Hooks

## pre-feature-setup

Creates database branches for each agent worktree (arena mode).

```bash
if [ "$AIGON_MODE" = "arena" ]; then
  for agent in $AIGON_AGENTS; do
    neon branches create --name "feature-${AIGON_FEATURE_ID}-${agent}"
  done
fi
```

## post-feature-setup

```bash
echo "Setup complete for feature $AIGON_FEATURE_ID in $AIGON_MODE mode"
```

## pre-feature-cleanup

Clean up database branches before removing worktrees (arena mode).

```bash
for agent in $AIGON_AGENTS; do
  neon branches delete "feature-${AIGON_FEATURE_ID}-${agent}" --force
done
```
```

### Supported Hooks

| Hook | Description |
|------|-------------|
| `pre-feature-now` | Runs before fast-track feature creation |
| `post-feature-now` | Runs after fast-track feature creation completes |
| `pre-feature-setup` | Runs before creating branch (solo) or worktrees (arena) |
| `post-feature-setup` | Runs after setup completes |
| `pre-feature-implement` | Runs before implementation begins |
| `post-feature-implement` | Runs after implementation setup |
| `pre-feature-done` | Runs before merging a feature |
| `post-feature-done` | Runs after a feature is merged |
| `pre-feature-cleanup` | Runs before cleaning up arena worktrees |
| `post-feature-cleanup` | Runs after arena cleanup |

### Environment Variables

Hooks have access to context via environment variables:

| Variable | Description | Available In |
|----------|-------------|--------------|
| `AIGON_COMMAND` | The command being run | All hooks |
| `AIGON_PROJECT_ROOT` | Root directory of the project | All hooks |
| `AIGON_MODE` | Current mode: "solo" or "arena" | Feature commands |
| `AIGON_FEATURE_ID` | Feature ID (e.g., "01") | Feature commands |
| `AIGON_FEATURE_NAME` | Feature name slug | Feature commands |
| `AIGON_AGENTS` | Space-separated list of agents | feature-setup (arena), feature-cleanup |
| `AIGON_AGENT` | Current agent name | feature-implement (arena), feature-done (arena) |
| `AIGON_WORKTREE_PATH` | Path to current worktree | feature-implement (arena) |

### Hook Behavior

- **Pre-hooks**: Run before the command executes. If a pre-hook fails (non-zero exit), the command is **aborted**.
- **Post-hooks**: Run after the command completes successfully. If a post-hook fails, a **warning** is shown but the command is considered complete.
- **Missing hooks file**: Silently ignored - hooks are optional.

### List Defined Hooks

```bash
aigon hooks list
```

---

## Project Profiles

Aigon auto-detects your project type and adapts arena behavior accordingly. For non-web projects (iOS, Android, libraries), this means no PORT assignment, no `.env.local` creation, and appropriate test instructions in templates.

### Auto-detection

| Profile | Detected By |
|---------|-------------|
| `ios` | `*.xcodeproj`, `*.xcworkspace`, `Package.swift` (root or `ios/` subdir) |
| `android` | `build.gradle`, `build.gradle.kts` (root or `android/` subdir) |
| `web` | `package.json` with `scripts.dev` + framework config (`next.config.*`, `vite.config.*`, etc.) |
| `api` | `manage.py`, `app.py`, `main.go`, `server.js`, `server.ts` |
| `library` | `Cargo.toml`, `go.mod`, `pyproject.toml`, `setup.py`, or `package.json` without dev script |
| `generic` | Fallback when nothing matches |

### Commands

```bash
# See what Aigon auto-detects
aigon profile detect

# View current profile and settings
aigon profile show

# Override auto-detection
aigon profile set ios

# After changing profile, regenerate templates
aigon update
```

The profile is stored in `.aigon/config.json` alongside the existing `.aigon/version` file. If no config exists, auto-detection is used.

### Profile Behavior

- **`web` / `api`**: Dev server enabled, agent-specific ports assigned, `.env.local` created in worktrees
- **`ios` / `android` / `library` / `generic`**: No dev server, no PORT, templates show project-appropriate test instructions

### Port Configuration

For `web` and `api` profiles, Aigon reads `PORT` from your `.env.local` or `.env` file and derives arena agent ports using fixed offsets:

```
PORT=3400 in .env → cc=3401, gg=3402, cx=3403, cu=3404
```

This avoids port clashes when running multiple Aigon projects simultaneously. Each worktree gets a `.env.local` with the agent-specific PORT written during `aigon feature-setup`.

A port summary is shown during `aigon init`, `aigon update`, `aigon install-agent`, and `aigon profile show`:

```
📋 Ports (from .env.local PORT=3400):
   Main:  3400
   Arena: cc=3401, gg=3402, cx=3403, cu=3404
```

If no PORT is found, Aigon falls back to profile defaults (3001-3004 for web, 8001-8004 for api) and suggests setting one.

---

## Local Dev Proxy

The dev proxy gives every dev server instance a meaningful subdomain URL instead of a port number. Agents run `aigon dev-server start`, get a URL like `http://cc-119.whenswell.test`, and everything just works — no port juggling, no collisions, no confusion.

### Why use the proxy?

Without the proxy, each agent worktree gets a static port (cc=3001, gg=3002). This causes friction:

- Agents forget to read `.env.local` or use the wrong port
- Two features by the same agent both want the same port
- Two projects on the same machine collide (both want 3001)
- Browser tabs at `localhost:3001` vs `localhost:3002` are hard to distinguish
- E2E tests need a stable base URL

With the proxy, every dev server gets a unique, memorable URL based on agent, feature, and app.

### URL Scheme

**Format:** `http://{agent}-{featureId}.{appId}.test`

| Scenario | URL |
|---|---|
| Claude on feature 119 of whenswell | `http://cc-119.whenswell.test` |
| Gemini on feature 119 of whenswell | `http://gg-119.whenswell.test` |
| Claude on feature 120 of whenswell | `http://cc-120.whenswell.test` |
| Claude on feature 5 of shopkeeper | `http://cc-5.shopkeeper.test` |
| Main branch / general dev | `http://whenswell.test` |

The `.test` TLD is IETF-reserved (RFC 6761) for testing. It won't conflict with real domains and works system-wide on macOS (Safari, curl, Node fetch, everything).

### Architecture

```
Browser: http://cc-119.whenswell.test
    ↓
dnsmasq: *.test → 127.0.0.1
    ↓
Caddy (:80): reverse_proxy → localhost:{dynamic-port}
    ↓
Dev server (port allocated dynamically)
```

### One-Time Machine Setup

Run this once on your machine:

```bash
aigon proxy-setup
```

This will:

1. **Install Caddy and dnsmasq** via Homebrew (if not already installed)
2. **Configure dnsmasq** to resolve all `*.test` domains to `127.0.0.1`
3. **Create `/etc/resolver/test`** so macOS uses dnsmasq for `.test` lookups (requires sudo — you'll be prompted)
4. **Start both services** via `brew services` (Caddy needs sudo for port 80)
5. **Verify** the setup works

The command is idempotent — safe to run multiple times. If anything is already installed, it skips those steps.

**Prerequisites:** Homebrew must be installed. macOS only for now.

#### What gets installed

| Component | Purpose | Managed by |
|---|---|---|
| dnsmasq | Resolves `*.test` → 127.0.0.1 | `brew services` |
| Caddy | Reverse proxy on port 80, routes subdomains to backend ports | `sudo brew services` |
| `/etc/resolver/test` | Tells macOS to use dnsmasq for `.test` domains | File (created by proxy-setup) |

#### Verifying the setup

```bash
# Check DNS resolution
dig anything.test @127.0.0.1

# Check services
brew services list | grep -E 'caddy|dnsmasq'

# Check resolver
cat /etc/resolver/test
# Should show: nameserver 127.0.0.1
```

### Per-Project Configuration

Add a `devProxy` section to your project's `.aigon/config.json`:

```json
{
  "profile": "web",
  "appId": "whenswell",
  "devProxy": {
    "command": "npm run dev",
    "healthCheck": "/api/health",
    "basePort": 3000
  }
}
```

| Field | Purpose | Default |
|---|---|---|
| `appId` | The app domain (`whenswell.test`) | `package.json` name or directory name |
| `devProxy.command` | How to start the dev server | `npm run dev` |
| `devProxy.healthCheck` | Path to verify the server is up | `/` |
| `devProxy.basePort` | Preferred starting port for allocation | `3000` |

Set values with:

```bash
aigon config set appId whenswell
aigon config set devProxy.basePort 3100
aigon config set devProxy.command "npm run dev"
```

The `appId` is auto-detected from `package.json` name or the git directory name if not set explicitly. It's sanitized for DNS (lowercased, `@scope/` stripped, non-alphanumeric replaced with hyphens).

**Only `web` and `api` profiles** use the dev proxy. iOS, Android, library, and generic profiles have no dev server, so `devProxy` doesn't apply.

### Dev Server Commands

#### `aigon dev-server start`

Starts the dev server process, allocates a port, registers with the proxy, and waits for the server to become healthy:

```bash
$ aigon dev-server start

⏳ Starting dev server: npm run dev
   Waiting for server on port 3847... ready!

🌐 Dev server running
   URL:  http://cc-119.whenswell.test
   Port: 3847  PID: 73524
   ID:   cc-119 (whenswell)
   Logs: aigon dev-server logs

   Open: http://cc-119.whenswell.test
```

The command:

1. **Auto-detects context** — app ID (from `.aigon/config.json`, `package.json`, or dirname), agent ID and feature ID (from worktree path or branch name)
2. **Allocates a port** — tries `basePort` + agent offset (cc=+1, gg=+2, cx=+3, cu=+4), scans upward if occupied
3. **Writes `PORT=<allocated>` to `.env.local`**
4. **Spawns the dev server** in the background using the `devProxy.command` from config (default: `npm run dev`), with `PORT` set in the environment
5. **Redirects output** to a log file at `~/.aigon/dev-proxy/logs/{appId}-{serverId}.log`
6. **Registers with the proxy** and reloads Caddy
7. **Waits for healthy** — polls the health check URL (default `/`) until the server responds (30s timeout)

On the main branch with no feature, it registers as the bare app domain (e.g., `http://whenswell.test`).

**Flags:**

- `--port N` — Use a specific port instead of auto-allocating
- `--register-only` — Only register the port mapping with the proxy; don't start the process (for manual process management)

#### `aigon dev-server stop`

Stops the dev server process and deregisters from the proxy:

```bash
aigon dev-server stop           # Auto-detects from context
aigon dev-server stop cc-119    # Specify server ID explicitly
```

This kills the process (using the PID from the registry) and removes the Caddy routing entry.

#### `aigon dev-server logs`

View dev server output:

```bash
aigon dev-server logs           # Last 50 lines (auto-detects server)
aigon dev-server logs -f        # Follow logs in real time (like tail -f)
aigon dev-server logs -n 100    # Last 100 lines
aigon dev-server logs cc-119    # Specify server ID
```

Log files are stored at `~/.aigon/dev-proxy/logs/{appId}-{serverId}.log`.

#### `aigon dev-server list`

Shows all active dev servers across all apps, with live PID status:

```bash
$ aigon dev-server list

   APP            SERVER      PORT   URL                              PID
   ───────────────────────────────────────────────────────────────────────────
   whenswell         cc-119      3847   http://cc-119.whenswell.test       73524
   whenswell         gg-119      4201   http://gg-119.whenswell.test       73801
   shopkeeper      cc-5        5832   http://cc-5.shopkeeper.test      75000
```

Dead processes are marked with `(dead)`.

#### `aigon dev-server gc`

Removes registry entries whose process is no longer running:

```bash
aigon dev-server gc
```

#### `aigon dev-server url`

Prints just the URL for the current context — useful in scripts:

```bash
BASE_URL=$(aigon dev-server url)
npx playwright test --base-url "$BASE_URL"
```

### How Agents Use the Dev Server

All agents (Claude Code, Gemini, Codex, Cursor) use the same `aigon dev-server start` command. This eliminates inconsistencies in how different agents handle dev servers:

- **No port guessing** — the port is allocated and set automatically
- **No background process management** — aigon spawns the process internally via Node.js `child_process.spawn` with `detached: true`, so agents don't need to figure out `&`, `nohup`, or PTY sessions
- **Logs are always available** — agents can run `aigon dev-server logs` to check startup output and diagnose errors
- **Cleanup is reliable** — `aigon dev-server stop` kills the process by PID, no guessing

The `feature-implement` template instructs agents to run `aigon dev-server start` at the testing step. Since the command handles everything (port allocation, process spawning, proxy registration, health check), all agents behave identically regardless of their runtime environment.

### Fallback (No Proxy)

If Caddy isn't installed or running, `aigon dev-server start` still works — it spawns the process, allocates a port, and uses `localhost:<port>` URLs:

```
⏳ Starting dev server: npm run dev
   Waiting for server on port 3001... ready!

📡 Dev server running
   URL:  http://localhost:3001
   Port: 3001  PID: 73524

   💡 Run `aigon proxy-setup` for subdomain routing (e.g., http://cc-119.whenswell.test)
   Logs: aigon dev-server logs

   Open: http://localhost:3001
```

All existing functionality continues to work unchanged.

### Multiple Apps on One Machine

Each app sets its own `appId`, so URLs are unique across projects:

- `http://cc-119.whenswell.test` (whenswell project)
- `http://cc-5.shopkeeper.test` (shopkeeper project)

Ports are allocated dynamically and can't collide — if one app takes port 3000, the next app automatically gets the next available port. You can optionally set different `devProxy.basePort` values per app for predictable port ranges:

```bash
# In whenswell
aigon config set devProxy.basePort 3000

# In shopkeeper
aigon config set devProxy.basePort 4000
```

### Runtime State

The proxy's runtime state lives in `~/.aigon/dev-proxy/`:

| File | Purpose |
|---|---|
| `servers.json` | Registry of currently running dev servers (app, port, PID, worktree path) |
| `Caddyfile` | Auto-generated Caddy config — regenerated on every start/stop |

These are ephemeral — not checked into any repo. The `servers.json` registry is the source of truth for what's currently running, and the Caddyfile is regenerated from it each time.

### Troubleshooting

**`aigon proxy-setup` hangs:** It may be waiting for your sudo password. Check the terminal for a password prompt.

**Caddy can't bind port 80:** Caddy needs root privileges for port 80. The proxy-setup uses `sudo brew services start caddy`. If Caddy is running as your user, stop it first: `brew services stop caddy`, then `sudo brew services start caddy`.

**DNS not resolving `.test` domains:** Verify `/etc/resolver/test` exists and contains `nameserver 127.0.0.1`. Then verify dnsmasq is running: `brew services list | grep dnsmasq`.

**`curl` works but browser doesn't:** Some browsers cache DNS. Try a hard refresh or clear the browser DNS cache. Safari works reliably with `.test` domains.

**Dev server starts but proxy returns 502:** The dev server may not be ready yet. Caddy is proxying to the registered port, but the dev server hasn't finished starting. Wait a moment and retry.

**Port already in use:** `aigon dev-server start` auto-allocates an available port. If you see errors, run `aigon dev-server gc` to clean up stale entries from crashed processes, then try again.

---

## Opening Worktrees

After setting up a feature with worktrees, use `/aigon:worktree-open` (or `aigon worktree-open`) to quickly open them in your configured terminal:

```bash
# Open specific feature's worktree (picks most recent if multiple)
/aigon:worktree-open 55
# or: aigon worktree-open 55

# Open specific agent's worktree for a feature
/aigon:worktree-open 55 cc
# or: aigon worktree-open 55 cc

# Open all arena agents side-by-side (Warp split panes)
/aigon:worktree-open 55 --all
# or: aigon worktree-open 55 --all

# Open multiple features side-by-side (parallel mode)
/aigon:worktree-open 100 101 102 --agent=cc
# or: aigon worktree-open 100 101 102 --agent=cc

# Override terminal for this invocation
/aigon:worktree-open 55 cc --terminal=code
# or: aigon worktree-open 55 cc --terminal=code
```

### Terminal Behavior

- **Warp**: Opens a new tab, sets the working directory, and automatically runs the agent CLI with the `feature-implement` slash command. Arena (`--all`) and parallel modes open split panes. Each pane echoes its port label on launch (e.g., `🔌 Claude — Port 3401`). Panes are ordered by port offset (cc, gg, cx, cu).
- **VS Code / Cursor**: Opens the folder; you'll need to run the agent command manually (shown in output). Split pane modes print commands for manual setup.

---

## Configuration

Aigon uses a unified `aigon config` command with two scopes:

- **Project** (`.aigon/config.json`) — per-project settings like profile, test instructions
- **Global** (`~/.aigon/config.json`) — user-wide settings like terminal, agent CLI flags

Project scope is the default. Use `--global` for user-wide settings.

### Config Commands

```bash
# Initialize config
aigon config init                           # Create project config (auto-detects profile)
aigon config init --global                  # Create global config

# Set values (dot-notation for nested keys)
aigon config set profile web                # Project: set profile
aigon config set --global terminal warp     # Global: set terminal
aigon config set arena.testInstructions "run npm test"

# Get values (shows where the value comes from)
aigon config get terminal                   # → warp (from ~/.aigon/config.json)
aigon config get profile                    # → web (from .aigon/config.json)

# Show config
aigon config show                           # Merged effective config (all levels)
aigon config show --global                  # Global config only
aigon config show --project                 # Project config only
```

### Global Config

```bash
aigon config init --global
```

Creates `~/.aigon/config.json`:

```json
{
  "terminal": "warp",
  "agents": {
    "cc": { "cli": "claude", "implementFlag": "--permission-mode acceptEdits" },
    "cu": { "cli": "agent", "implementFlag": "--force" },
    "gg": { "cli": "gemini", "implementFlag": "--yolo" },
    "cx": { "cli": "codex", "implementFlag": "--full-auto" }
  }
}
```

### Project Config

```bash
aigon config init
```

Creates `.aigon/config.json` with the auto-detected profile:

```json
{
  "profile": "web"
}
```

### Configuration Options

- `terminal`: Default terminal for `worktree-open`. Options: `warp` (auto-runs agent), `code` (VS Code), `cursor`
- `profile`: Project profile (`web`, `api`, `ios`, `android`, `library`, `generic`)
- `agents.{id}.cli`: Override the CLI command for each agent
- `agents.{id}.implementFlag`: Override CLI flags to control permission prompts
- `arena.testInstructions`: Custom test instructions for arena mode

### CLI Flag Overrides

By default, Aigon uses "yolo mode" flags that auto-approve commands:
- **cc** (Claude): `--permission-mode acceptEdits` (auto-edits, prompts for risky Bash)
- **cu** (Cursor): `--force` (auto-approves commands)
- **gg** (Gemini): `--yolo` (auto-approves all)
- **cx** (Codex): `--full-auto` (workspace-write, smart approval)

For stricter security (e.g., corporate environments):

```bash
aigon config set --global agents.cc.implementFlag ""
aigon config set --global agents.cu.implementFlag ""
```

Set `implementFlag` to `""` (empty string) to remove auto-approval flags and require manual permission prompts.

### Precedence

**Priority order:** Project config > Global config > Defaults

Use `aigon config get <key>` to see which level a value comes from.

### Environment Variable Override

Set `AIGON_TERMINAL=code` to override the terminal for a single session.

---

## Multi-Agent Evaluation Examples

When running multi-agent arenas, use `/aigon:feature-eval <ID>` (or `aigon feature-eval <ID>`) to generate an evaluation template and compare implementations. For unbiased evaluation, **use a different model as the evaluator** than the ones that wrote the code.

### Evaluator Model Recommendation

If using Claude as the evaluator, start it with a different model:

```bash
# If implementations were written by Opus, evaluate with Sonnet
claude --model sonnet

# Then run the evaluation command
/aigon:feature-eval 10
# or: aigon feature-eval 10
```

### Example Evaluation Output

Here's an example of what a multi-agent evaluation produces:

```markdown
# Evaluation: Feature 10 - add-search-box

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-10-add-search-box.md`

## Implementations to Compare

- [x] **cc**: `~/src/feature-10-cc-add-search-box` - ✅ IMPLEMENTED
- [x] **cx**: `~/src/feature-10-cx-add-search-box` - ✅ IMPLEMENTED
- [x] **gg**: `~/src/feature-10-gg-add-search-box` - ✅ IMPLEMENTED

## Evaluation Criteria

| Criteria | cc | cx | gg |
|----------|----|----|-----|
| Code Quality | 9/10 | 10/10 | 6/10 |
| Spec Compliance | 10/10 | 10/10 | 7/10 |
| Performance | 9/10 | 10/10 | 8/10 |
| Maintainability | 9/10 | 10/10 | 6/10 |
| **TOTAL** | **37/40** | **40/40** | **27/40** |

## Summary

### Strengths & Weaknesses

#### cc (Claude Code)
**Strengths:**
- ✅ **Perfect spec compliance**: All acceptance criteria met
- ✅ **Proper normalization**: Implements punctuation removal and case-insensitive search
- ✅ **Smart data mapping**: Created mapping to handle UI/data model differences
- ✅ **Type safety**: Strong TypeScript typing
- ✅ **Comprehensive documentation**: Detailed implementation log

**Weaknesses:**
- ⚠️ **Mapping complexity**: Adds some complexity (though preserves data integrity)

#### cx (Codex)
**Strengths:**
- ✅ **Perfect spec compliance**: All acceptance criteria met flawlessly
- ✅ **Excellent normalization**: Robust text handling
- ✅ **Optimal performance**: Uses `useMemo` with proper dependency arrays
- ✅ **Superior organization**: Clean, readable, well-structured

**Weaknesses:**
- (None identified - production-ready implementation)

#### gg (Gemini)
**Strengths:**
- ✅ **Functional implementation**: Core functionality works
- ✅ **Debounce implemented**: Correct delay

**Weaknesses:**
- ❌ **Spec violation**: Missing punctuation handling
- ⚠️ **Less optimal performance**: Uses `useEffect` instead of `useMemo`
- ⚠️ **Poor UX**: No labels on filters
```

### After Evaluation

Once you've chosen a winner, merge their implementation:

```bash
# Merge the winning implementation
/aigon:feature-done 10 cx
# or: aigon feature-done 10 cx

# Push losing branches to origin for safekeeping (optional)
/aigon:feature-cleanup 10 --push
# or: aigon feature-cleanup 10 --push

# Or just delete losing branches locally
/aigon:feature-cleanup 10
# or: aigon feature-cleanup 10
```

---

## Contributing / Developing Aigon

If you're working on Aigon itself, be aware of the template system:

- **Source of truth**: `templates/generic/commands/` and `templates/generic/docs/`
- **Working copies**: `.claude/commands/`, `.cursor/commands/`, `.gemini/commands/` (gitignored, generated)

The agent directories (`.claude/`, `.cursor/`, etc.) and root files (`CLAUDE.md`, `GEMINI.md`) are gitignored because they're generated from templates during `aigon install-agent`.

### Development Workflow

1. Edit templates in `templates/generic/commands/`
2. Run `aigon update` or `aigon install-agent cc` to regenerate working copies
3. Test the commands in your agent session
4. Commit only the template changes (the working copies stay local)

### Generated Files

When you run `aigon install-agent`, it creates:

- Root files like `CLAUDE.md`, `GEMINI.md` (where applicable)
- `docs/agents/*.md`
- Command files under `.claude/`, `.gemini/`, `.cursor/`, and `~/.codex/prompts/`
- Agent-specific config files (`.cursor/cli.json`, etc.)

**Important:** You must commit the generated configuration files to Git. This ensures that when `aigon` creates a new git worktree, the agent configurations are available in that isolated environment.

---

📘 **For quick reference and getting started, return to the main [README.md](../README.md)**
