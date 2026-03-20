# Aigon: Detailed Workflows & Configuration

**Comprehensive reference for detailed workflows, advanced configuration, and best practices.**

For a quick overview and getting started, see the main [README.md](README.md).

---

## Table of Contents

1. [Command Surfaces (CLI vs In-Agent)](#command-surfaces-cli-vs-in-agent)
2. [Detailed Feature Lifecycle](#detailed-feature-lifecycle)
3. [Detailed Research Lifecycle](#detailed-research-lifecycle)
4. [Detailed Feedback Lifecycle](#detailed-feedback-lifecycle)
5. [Agent Status Tracking](#agent-status-tracking)
6. [Traceability](#traceability)
7. [Hooks Deep Dive](#hooks-deep-dive)
8. [Project Profiles](#project-profiles)
9. [Local Dev Proxy](#local-dev-proxy)
10. [Opening Worktrees](#opening-worktrees)
11. [Configuration](#configuration)
12. [Multi-Agent Evaluation Examples](#multi-agent-evaluation-examples)
13. [CLI Reference](#cli-reference)
14. [Contributing / Developing Aigon](#contributing--developing-aigon)

---

## Command Surfaces (CLI vs In-Agent)

Aigon runs on two command surfaces:

- **CLI context**: `aigon ...` in a normal shell
- **In-agent context**: slash commands inside an active agent session

This is independent from workflow mode (Drive/Fleet/Autopilot/Swarm).

### Start here (practical default)

1. Start in an **in-agent session** when defining work (`feature-create`, `feature-prioritise`, `research-create`, `research-prioritise`) so you can iterate conversationally.
2. Stay **in-agent** for execution (`feature-do`, `feature-review`, `research-do`, `research-synthesize`).
3. Use **CLI context** for orchestration and terminal operations (`feature-start`, `feature-open`, `feature-eval` (Fleet), `feature-close`, `feature-cleanup`), especially from the main repo.

### Surface recommendations

| Command Group | Preferred Surface | Notes |
|---|---|---|
| Spec authoring/refinement (`feature-create`, `feature-prioritise`, `research-create`, `research-prioritise`) | In-agent | Best for back-and-forth definition and scope shaping |
| Agent execution (`feature-do`, `feature-review`, `research-do`, `research-synthesize`) | In-agent | Best when an agent session is already active |
| Setup/orchestration (`init`, `install-agent`, `update`, `feature-start`, `research-start`, `feature-open`, `feature-close`, `feature-cleanup`) | CLI | Repo/worktree operations and coordination |
| Infra/config (`config`, `profile`, `proxy`, `dev-server`, `dashboard`) | CLI | Machine/project configuration and services |

### Mode × surface matrix

| Mode | CLI Context | In-Agent Context |
|---|---|---|
| Drive | Fully supported | Fully supported |
| Fleet | Fully supported (strong for orchestration) | Fully supported (strong for per-agent execution) |
| Autopilot | Primary entry point (`feature-do --autonomous`) | Supported when already in-session |
| Swarm | Primary entry point (`feature-start ... --autonomous`) | Limited manual use after launch (agents run autonomously) |

The matrix describes common usage, not hard restrictions. In general, both surfaces are available; the best choice depends on whether you're iterating with an agent or orchestrating repo/worktree state.

### Common confusion clarified

- **“Do I need to start inside an agent?”** Not required, but recommended for spec definition and iterative refinement.
- **“Can I stay CLI-only?”** Yes. CLI-only is supported, especially for terminal-first workflows and automation.
- **“Is CLI optional?”** Yes. Most day-to-day feature/research authoring and execution can happen inside agent sessions via slash commands.
- **“Why does `feature-do` behave differently?”** In shell context, it can launch an agent. In-agent context, it provides instruction flow in the active session.

---

## Detailed Feature Lifecycle

### Fast-Track (Drive Branch)

For features where you want to go from idea to implementation immediately:

* **Now:** `/aigon:feature-now dark-mode` (or `aigon feature-now dark-mode`) — if `dark-mode` matches an existing feature in the inbox, it runs prioritise → setup → implement. Otherwise it creates a new spec directly in `/in-progress`, assigns an ID, creates a Drive branch, and commits atomically. Either way, you go from name to implementation in one session.
* **Implement:** `aigon feature-do <ID>` (launches the default `cc` agent from a plain shell) or `aigon feature-do <ID> --agent=cx` (launches Codex). Inside an agent session use `/aigon:feature-do <ID>` (or `/aigon-feature-do <ID>` for Cursor, `/prompts:aigon-feature-do <ID>` for Codex).
* **Done:** `/aigon:feature-close <ID>` (or `aigon feature-close <ID>`) merges and completes.

This skips the inbox/backlog/setup steps entirely. Use the slash command for the full guided experience.

### Drive Mode (Single Agent)

Drive mode supports two workspace styles: **branch** (work in the current repo) or **worktree** (isolated directory for parallel development).

1.  **Create:** `/aigon:feature-create "Dark Mode"` (or `aigon feature-create "Dark Mode"`) creates a templated spec in `/inbox`.
    * The agent **explores the codebase** before writing the spec to understand existing architecture, patterns, and constraints.
2.  **Prioritise:** `/aigon:feature-prioritise dark-mode` (or `aigon feature-prioritise dark-mode`) assigns an ID and moves to `/backlog`.
3.  **Setup:**
    * **Branch mode:** `/aigon:feature-start 108` (or `aigon feature-start 108`) — creates a Git branch (`feature-108-dark-mode`) in the current repo.
    * **Worktree mode:** `/aigon:feature-start 108 cc` (or `aigon feature-start 108 cc`) — creates an isolated worktree at `../<repo>-worktrees/feature-108-cc-dark-mode`, ideal for working on multiple features in parallel.
    * Both modes auto-create an Implementation Log and write agent status to `.aigon/state/` (see [Agent Status Tracking](#agent-status-tracking)).
4.  **Implement:** `aigon feature-do 108` (launches the default `cc` agent from a plain shell) or `aigon feature-do 108 --agent=cx` (launch Codex). Inside an active agent session, use `/aigon:feature-do 108` (or `/aigon-feature-do 108` for Cursor, `/prompts:aigon-feature-do 108` for Codex) to show instructions without launching a nested agent.
    * **Shell-launch mode** (plain terminal, no active agent): Aigon detects no agent session and spawns the chosen agent directly. Default agent is `cc`; override with `--agent=<cc|gg|cx|cu>`.
    * **Instruction mode** (inside an agent session): Aigon detects the active session and shows spec location and next steps instead of launching another agent.
    * Agent reads the feature spec and creates **tasks from the acceptance criteria** for progress tracking.
    * Agent codes the solution, auto-signals status transitions (`implementing` → `waiting`), and *must* fill out the Implementation Log.
    * Before stopping, agents provide a **Manual Testing Checklist** and (for web/API projects) start and open the dev server so you can verify immediately.
5.  **Cross-Agent Review (Optional):** Have a different agent review the code and commit fixes:
    * Open a session with a different agent (e.g., Codex if Claude implemented)
    * `/aigon:feature-review 108` (or `/aigon-feature-review 108` for Cursor, `/prompts:aigon-feature-review 108` for Codex)
    * The reviewing agent reads the spec, reviews `git diff main...HEAD`, and commits targeted fixes with `fix(review):` prefix
    * Review the fix commits before proceeding
6.  **Finish:** `/aigon:feature-close 108` (or `aigon feature-close 108`)
    * Merges the branch and archives the log.
    * For Drive mode (worktree), the agent is auto-detected — no need to specify it.

### Fleet Mode (Multi-Agent Competition)

Run multiple agents in competition to find the optimal solution.

1.  **Create:** `/aigon:feature-create "Dark Mode"` (or `aigon feature-create "Dark Mode"`) creates a templated spec in `/inbox`.
    * The agent **explores the codebase** before writing the spec.
2.  **Prioritise:** `/aigon:feature-prioritise dark-mode` (or `aigon feature-prioritise dark-mode`) assigns an ID and moves to `/backlog`.
3.  **Setup Fleet:** `/aigon:feature-start 108 cc gg cx` (or `aigon feature-start 108 cc gg cx`)
    * Moves Spec to `/03-in-progress`.
    * Creates agent-specific **Git Branches** (`feature-108-cc-dark-mode`, `feature-108-gg-dark-mode`, `feature-108-cx-dark-mode`).
    * Creates **Git Worktrees** in a grouped folder:
        * `../<repo>-worktrees/feature-108-cc-dark-mode` (Claude)
        * `../<repo>-worktrees/feature-108-gg-dark-mode` (Gemini)
        * `../<repo>-worktrees/feature-108-cx-dark-mode` (Codex)
    * **Auto-creates** Implementation Log templates in each worktree and writes agent status to `.aigon/state/`.
    * **STOPS** - does not implement (user must open each worktree separately).
4.  **Implement:** Open all worktrees side-by-side with `aigon feature-open 108 --all` (or individually with `aigon feature-open 108 cc`), or launch an agent directly from a worktree shell with `aigon feature-do 108`.
    * **Warp**: Opens all agents side-by-side in split panes and auto-starts each with `/aigon:feature-do 108`.
    * **tmux**: Creates persistent named sessions (`aigon-f108-cc`, `aigon-f108-gg`, etc.) that survive terminal closes. Detach with `Ctrl-b d`, reattach anytime. With `tmuxApp: "iterm2"`, sessions open as native iTerm2 tabs.
    * **VS Code / Cursor**: Opens the folder; run `aigon feature-do 108` in the integrated terminal — Aigon detects no active session and launches the agent automatically. Alternatively run `/aigon:feature-do 108` inside an already-open agent session.
    * **Terminal.app**: Opens a new window per agent with the command auto-started.
    * Single agent: Opens one worktree with agent CLI pre-loaded.
    * **Fleet mismatch protection:** If `--agent=gg` is specified inside a `feature-108-cc-*` worktree, Aigon exits with a clear error instead of launching the wrong agent.
    * Each agent builds the feature independently in their isolated worktree.
    * Each agent creates **tasks from the acceptance criteria** and *must* fill out their Implementation Log.
5.  **Cross-Agent Review (Optional):** Before evaluation, have different agents review each implementation:
    * In each worktree, open a session with a different agent
    * `/aigon:feature-review 108` (or `/aigon-feature-review 108` for Cursor, `/prompts:aigon-feature-review 108` for Codex)
    * Reviewing agent commits fixes with `fix(review):` prefix
6.  **Evaluate:** Back in the main folder, run `/aigon:feature-eval 108` (or `aigon feature-eval 108`).
    * Moves the feature to `/in-evaluation`.
    * Creates comparison template with all implementations.
    * Warns if the evaluator shares a provider family with the implementer (use `--allow-same-model-judge` to suppress).
7.  **Judge:** Review and compare solutions, fill in the evaluation.
8.  **Merge Winner:**
    ```bash
    /aigon:feature-close 108 cc
    # or: aigon feature-close 108 cc
    ```
    * Merges winner's branch.
    * Moves winning agent's log to `logs/selected`.
    * Moves losing agent's logs to `logs/alternatives` (preserving history).
    * Cleans up winner's worktree.
9.  **Adopt from Losers (Optional):** Cherry-pick valuable improvements from losing agents:
    ```bash
    /aigon:feature-close 108 cc --adopt all
    # or: aigon feature-close 108 cc --adopt gg cx
    ```
    * Merges the winner as normal, then prints diffs from each losing agent.
    * Review diffs for extra tests, error handling, docs, and edge cases.
    * Selectively apply improvements, test, and commit.
    * Adopted agent branches are kept for reference until cleanup.
10. **Cleanup Losers:**
    ```bash
    /aigon:feature-cleanup 108 [--push]
    # or: aigon feature-cleanup 108 [--push]
    ```
    * Removes losing worktrees and branches.
    * Optional `--push` flag pushes branches to origin before deleting.

---

## Detailed Research Lifecycle

### Drive Mode (Single Agent)

* **Create:** `/aigon:research-create "API Design"` (or `aigon research-create "API Design"`) creates a templated topic in `/01-inbox`. The agent **explores the codebase** before writing the topic to understand relevant existing code and constraints.
* **Prioritise:** `/aigon:research-prioritise api-design` (or `aigon research-prioritise api-design`) moves it to `/02-backlog` and assigns a global ID.
* **Setup:** `/aigon:research-start 05` (or `aigon research-start 05`) moves to `/03-in-progress`.
* **Execute:** `/aigon:research-do 05` (or `/aigon-research-do 05` for Cursor, `/prompts:aigon-research-do 05` for Codex). Agent reads the topic file, writes findings and recommendations directly into the document.
* **Done:** `/aigon:research-close 05` (or `aigon research-close 05`) moves to `/04-done`.
* **Output:** The research file becomes a complete record, with suggested features in the Output section.

### Fleet Mode (Multi-Agent Research)

Run multiple agents to get diverse perspectives on a research topic.

* **Create:** `/aigon:research-create "API Design"` (or `aigon research-create "API Design"`) creates a templated topic in `/01-inbox`. The agent **explores the codebase** first.
* **Prioritise:** `/aigon:research-prioritise api-design` (or `aigon research-prioritise api-design`) moves it to `/02-backlog` and assigns a global ID.
* **Setup Fleet:** `/aigon:research-start 05 cc gg cx` (or `aigon research-start 05 cc gg cx`)
    * Moves topic to `/03-in-progress`.
    * Creates **separate findings files** for each agent in `logs/`:
        * `research-05-cc-findings.md` (Claude)
        * `research-05-gg-findings.md` (Gemini)
        * `research-05-cx-findings.md` (Codex)
* **Execute:** Open all agents side-by-side with `/aigon:research-open 05` (or `aigon research-open 05`), then run `/aigon:research-do 05` in each agent session.
    * Each agent writes ONLY to their own findings file.
    * Agents must NOT run `research-close` (user handles synthesis).
* **Synthesize:** `/aigon:research-synthesize 05` (or `/aigon-research-synthesize 05` for Cursor, `/prompts:aigon-research-synthesize 05` for Codex) with an agent to:
    * Read and compare ALL agents' findings
    * Present a synthesis with recommendations
    * Ask you which features to include (via chat)
    * Update the main research doc with your selections
    * **Tip:** Use a different model than those that conducted the research for unbiased synthesis
* **Complete:** `/aigon:research-close 05 --complete` (or `aigon research-close 05 --complete`) moves to `/04-done`.
* **Output:** The main research file contains the synthesized recommendation, with findings files preserved in `logs/`.

---

## Detailed Feedback Lifecycle

Feedback captures raw user/customer input and routes it back into your product workflow. Unlike features (what to build) and research (how to explore), feedback represents **external signal** that closes the loop between shipped code and user experience.

### Create Feedback Item

Create a new feedback item in the inbox:

```bash
/aigon:feedback-create "User login is slow on mobile"
# or: aigon feedback-create "User login is slow on mobile"
```

This creates `docs/specs/feedback/01-inbox/feedback-01-user-login-is-slow-on-mobile.md` with:
- Auto-assigned numeric ID
- YAML front matter (status, type, reporter, source)
- Sections for Summary, Evidence, Triage Notes, and Proposed Next Action

**Fill in attribution:**
- `reporter`: Who provided the feedback (name/email)
- `source`: Where it came from (support-ticket, slack, user-interview, etc.)
- `source.url`: Optional link to original source (system-agnostic)

### List and Filter Feedback

View feedback items with various filters:

```bash
/aigon:feedback-list
# or: aigon feedback-list

# Active lanes only (inbox, triaged, actionable)
aigon feedback-list

# Specific status
aigon feedback-list --inbox
aigon feedback-list --triaged
aigon feedback-list --actionable

# By metadata
aigon feedback-list --type bug
aigon feedback-list --severity critical
aigon feedback-list --tag mobile

# All feedback (including done, wont-fix, duplicate)
aigon feedback-list --all
```

### Triage Feedback (AI-Assisted)

Triage feedback with AI assistance for classification and duplicate detection:

```bash
/aigon:feedback-triage 01
# or: aigon feedback-triage 01
```

**The triage workflow:**

1. **AI analyzes** the feedback and suggests:
   - Type (bug, feature-request, question, etc.)
   - Severity (low, medium, high, critical)
   - Tags for categorization
   - Duplicate candidates (based on title + summary similarity)
   - Next action (keep, mark-duplicate, promote-feature, promote-research, wont-fix)

2. **You confirm** the suggestions and apply changes:
```bash
aigon feedback-triage 01 \
  --type bug \
  --severity high \
  --tags "mobile,performance" \
  --status triaged \
  --apply --yes
```

3. **File moves** to `02-triaged/` and YAML front matter is updated

**Duplicate handling:**
```bash
# Mark as duplicate and link to canonical item
aigon feedback-triage 05 \
  --status duplicate \
  --duplicate-of 02 \
  --apply --yes
```
File moves to `06-duplicate/` with `duplicate_of: 02` in front matter.

**Mark as actionable:**
```bash
# Ready to promote to research/feature
aigon feedback-triage 01 \
  --status actionable \
  --apply --yes
```
File moves to `03-actionable/`, ready to be turned into a research topic or feature spec.

### Safety Model

Feedback triage uses a **preview-first** approach:
- Default: Shows what would change without modifying files
- Apply: Requires explicit `--apply --yes` to commit changes
- No interactive prompts (safe for automation)

This prevents accidental data corruption while allowing scripted workflows.

---

## Agent Status Tracking

Aigon tracks live agent state in JSON files under `.aigon/state/`. This lets you (and tooling like the dashboard) see what every agent is doing without watching terminals.

### How it works

As agents work through `feature-do` and `feature-submit`, they call `aigon agent-status` at key transitions. Each call writes to `.aigon/state/feature-{id}-{agent}.json` in the **main repo** (not inside worktrees):

| Lifecycle point | Status |
|---|---|
| Start of implementation | `implementing` |
| Before STOP/WAIT at end of testing | `waiting` |
| After final log commit in feature-submit | `submitted` |

### Checking status

```bash
aigon status          # All in-progress features
aigon status 31       # One feature, per-agent table
```

Output:
```
#31  log-status-tracking
  cc    waiting        11:23
  gg    implementing   11:15
  cx    submitted      10:58
```

### Manually setting status

Agents call this automatically, but you can set it manually too:

```bash
aigon agent-status implementing
aigon agent-status waiting
aigon agent-status submitted
```

The command auto-detects the feature ID and agent from the current branch name.

---

## Dashboard: Live Multi-Repo Monitoring

The Aigon Dashboard is a foreground HTTP server that watches all your registered repos and provides a web UI for monitoring features, agent status, and statistics.

### Register your repos

```bash
aigon dashboard add ~/src/my-project
aigon dashboard add ~/src/another-project
aigon dashboard list                       # See what's registered
aigon dashboard remove ~/src/old-project   # Unregister a repo
```

### Start the dashboard

```bash
aigon dashboard start           # Start the service (default port 4321)
aigon dashboard status          # Check it's running + see waiting agents
aigon dashboard open            # Open the web dashboard in your browser
aigon dashboard stop            # Shut it down
```

The service polls every 30 seconds and fires a macOS notification when an agent reaches `waiting` or when all agents submit.

You can also jump to an agent's terminal directly:

```bash
aigon terminal-focus 39        # Open terminal for feature #39
aigon terminal-focus 39 cc     # Specific agent
```

---

## Traceability

Aigon supports forward and backward traceability across its three lifecycles. For the full lifecycle overview, see the [README — Complete Product Lifecycle](README.md#complete-product-lifecycle-research--ideas--features--feedback-loop).

**Forward traceability** (why we built this):
- Feature spec references feedback IDs and research IDs
- "Feature #108 addresses feedback #42 and was informed by research #07"

**Backward traceability** (what happened to my request):
- Feedback item's `linked_features` field tracks spawned work
- Research topic's output section lists created features
- "Feedback #42 resulted in feature #108, shipped in v2.1"

### Example Flow

1. **User reports bug** → `aigon feedback-create "Export broken on Safari"`
2. **Triage suggests type=bug, severity=high** → Move to triaged
3. **Product decision** → Mark as actionable
4. **Create feature from feedback** → `aigon feature-create "fix-safari-export"` and link to feedback #12 in the spec
5. **Implement and ship** → Feature goes through normal workflow
6. **User confirms fix** → Mark feedback #12 as done
7. **New feedback arrives** → Cycle continues

This creates a transparent, evidence-based product development process where every decision traces back to user needs or technical exploration.

---

## Hooks Deep Dive

Hooks allow you to run custom scripts before and after Aigon commands. This is useful for integrating with your specific infrastructure (databases, deployment platforms, etc.) without modifying the core Aigon commands.

### Hooks File

Define hooks in `docs/aigon-hooks.md`. Aigon automatically detects and runs hooks based on heading names.

### Hooks Format

```markdown
# Aigon Hooks

## pre-feature-start

Creates database branches for each agent worktree (Fleet mode).

```bash
if [ "$AIGON_MODE" = "fleet" ]; then
  for agent in $AIGON_AGENTS; do
    neon branches create --name "feature-${AIGON_FEATURE_ID}-${agent}"
  done
fi
```

## post-feature-start

```bash
echo "Setup complete for feature $AIGON_FEATURE_ID in $AIGON_MODE mode"
```

## pre-feature-cleanup

Clean up database branches before removing worktrees (Fleet mode).

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
| `pre-feature-start` | Runs before creating branch (Drive) or worktrees (Fleet) |
| `post-feature-start` | Runs after setup completes |
| `pre-feature-do` | Runs before implementation begins |
| `post-feature-do` | Runs after implementation setup |
| `pre-feature-close` | Runs before merging a feature |
| `post-feature-close` | Runs after a feature is merged |
| `pre-feature-cleanup` | Runs before cleaning up Fleet worktrees |
| `post-feature-cleanup` | Runs after Fleet cleanup |

### Environment Variables

Hooks have access to context via environment variables:

| Variable | Description | Available In |
|----------|-------------|--------------|
| `AIGON_COMMAND` | The command being run | All hooks |
| `AIGON_PROJECT_ROOT` | Root directory of the project | All hooks |
| `AIGON_MODE` | Current mode: "drive" or "fleet" | Feature commands |
| `AIGON_FEATURE_ID` | Feature ID (e.g., "01") | Feature commands |
| `AIGON_FEATURE_NAME` | Feature name slug | Feature commands |
| `AIGON_AGENTS` | Space-separated list of agents | feature-start (Fleet), feature-cleanup |
| `AIGON_AGENT` | Current agent name | feature-do (Fleet), feature-close (Fleet) |
| `AIGON_WORKTREE_PATH` | Path to current worktree | feature-do (Fleet) |

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

Aigon auto-detects your project type and adapts Fleet behavior accordingly. For non-web projects (iOS, Android, libraries), this means no PORT assignment, no `.env.local` creation, and appropriate test instructions in templates.

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

For `web` and `api` profiles, Aigon reads `PORT` from your `.env.local` or `.env` file and derives Fleet agent ports using fixed offsets:

```
PORT=3400 in .env → cc=3401, gg=3402, cx=3403, cu=3404
```

This avoids port clashes when running multiple Aigon projects simultaneously. Each worktree gets a `.env.local` with the agent-specific PORT written during `aigon feature-start`.

A port summary is shown during `aigon init`, `aigon update`, `aigon install-agent`, and `aigon profile show`:

```
📋 Ports (from .env.local PORT=3400):
   Main:  3400
   Fleet: cc=3401, gg=3402, cx=3403, cu=3404
```

If no PORT is found, Aigon falls back to profile defaults (3001-3004 for web, 8001-8004 for api) and suggests setting one.

---

## Local Dev Proxy

The dev proxy gives every dev server instance a meaningful subdomain URL instead of a port number. Agents run `aigon dev-server start`, get a URL like `http://cc-119.whenswell.localhost`, and everything just works — no port juggling, no collisions, no confusion.

### Why use the proxy?

Without the proxy, each agent worktree gets a static port (cc=3001, gg=3002). This causes friction:

- Agents forget to read `.env.local` or use the wrong port
- Two features by the same agent both want the same port
- Two projects on the same machine collide (both want 3001)
- Browser tabs at `localhost:3001` vs `localhost:3002` are hard to distinguish
- E2E tests need a stable base URL

With the proxy, every dev server gets a unique, memorable URL based on agent, feature, and app.

### URL Scheme

**Format:** `http://{agent}-{featureId}.{appId}.localhost`

| Scenario | URL |
|---|---|
| Claude on feature 119 of whenswell | `http://cc-119.whenswell.localhost` |
| Gemini on feature 119 of whenswell | `http://gg-119.whenswell.localhost` |
| Claude on feature 120 of whenswell | `http://cc-120.whenswell.localhost` |
| Claude on feature 5 of shopkeeper | `http://cc-5.shopkeeper.localhost` |
| Main branch / general dev | `http://whenswell.localhost` |

`.localhost` domains resolve to `127.0.0.1` automatically per RFC 6761 — **no DNS configuration needed**. Works on all modern OSes (macOS, Linux, Windows) without any setup.

### Architecture

```
Browser: http://cc-119.whenswell.localhost
    ↓
OS: *.localhost → 127.0.0.1 (RFC 6761, zero config)
    ↓
aigon-proxy (port 80 or 4100): routes by Host header → localhost:{dynamic-port}
    ↓
Dev server (port allocated dynamically)
```

### Setup

```bash
aigon proxy start    # Start the aigon-proxy daemon
aigon proxy install  # Optional: install launchd plist for auto-start on boot (macOS)
```

No Homebrew, no sudo, no DNS configuration. The proxy reads `~/.aigon/dev-proxy/servers.json` on each request — zero state to sync.

#### Verifying the setup

```bash
aigon proxy status   # Check if proxy is running
aigon proxy install  # One-time: install as system daemon on port 80
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
| `appId` | The app domain (`whenswell.localhost`) | `package.json` name or directory name |
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
   URL:  http://cc-119.whenswell.localhost
   Port: 3847  PID: 73524
   ID:   cc-119 (whenswell)
   Logs: aigon dev-server logs

   Open: http://cc-119.whenswell.localhost
```

The command:

1. **Auto-detects context** — app ID (from `.aigon/config.json`, `package.json`, or dirname), agent ID and feature ID (from worktree path or branch name)
2. **Allocates a port** — tries `basePort` + agent offset (cc=+1, gg=+2, cx=+3, cu=+4), scans upward if occupied
3. **Writes `PORT=<allocated>` to `.env.local`**
4. **Spawns the dev server** in the background using the `devProxy.command` from config (default: `npm run dev`), with `PORT` set in the environment
5. **Redirects output** to a log file at `~/.aigon/dev-proxy/logs/{appId}-{serverId}.log`
6. **Registers with the proxy** by writing to `servers.json` (aigon-proxy reads it live)
7. **Waits for healthy** — polls the health check URL (default `/`) until the server responds (30s timeout)

On the main branch with no feature, it registers as the bare app domain (e.g., `http://whenswell.localhost`).

**Flags:**

- `--port N` — Use a specific port instead of auto-allocating
- `--register-only` — Only register the port mapping with the proxy; don't start the process (for manual process management)

#### `aigon dev-server stop`

Stops the dev server process and deregisters from the proxy:

```bash
aigon dev-server stop           # Auto-detects from context
aigon dev-server stop cc-119    # Specify server ID explicitly
```

This kills the process (using the PID from the registry) and removes the entry from `servers.json`.

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
   whenswell         cc-119      3847   http://cc-119.whenswell.localhost   73524
   whenswell         gg-119      4201   http://gg-119.whenswell.localhost   73801
   shopkeeper      cc-5        5832   http://cc-5.shopkeeper.localhost 75000
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

The `feature-do` template instructs agents to run `aigon dev-server start` at the testing step. Since the command handles everything (port allocation, process spawning, proxy registration, health check), all agents behave identically regardless of their runtime environment.

### Fallback (No Proxy)

If the proxy isn't running, `aigon dev-server start` still works — it spawns the process, allocates a port, and uses `localhost:<port>` URLs. Run `aigon proxy install` to enable named URLs.

### Multiple Apps on One Machine

Each app sets its own `appId`, so URLs are unique across projects:

- `http://cc-119.whenswell.localhost` (whenswell project)
- `http://cc-5.shopkeeper.localhost` (shopkeeper project)

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
| `proxy.pid` | PID of the running aigon-proxy daemon |
| `proxy.log` | Proxy daemon log output |

These are ephemeral — not checked into any repo. The `servers.json` registry is the source of truth for what's currently running. The proxy reads it live on each request.

### Troubleshooting

**Proxy not running:** Run `aigon proxy install` (one-time, asks for sudo). This installs a system daemon on port 80 that starts on boot and auto-restarts on crash.

**`aigon proxy status` shows not running after install:** Check `~/.aigon/dev-proxy/proxy.log` for errors. Most common: `http-proxy` not installed — run `npm install` in the aigon directory.

**Dev server starts but proxy returns 502:** The dev server may not be ready yet. Wait a moment and retry.

**Port already in use:** `aigon dev-server start` auto-allocates an available port. If you see errors, run `aigon dev-server gc` to clean up stale entries from crashed processes, then try again.

**Dashboard shows wrong data or behaves unexpectedly:** Check the dashboard log for errors and warnings:

```bash
tail -50 ~/.aigon/dashboard.log
```

The log records every warning emitted during startup and operation, including config parse failures, stale registry entries removed, and file permission errors. Parse warnings look like `[global config] Warning: Unexpected token ...` and indicate a corrupted config file.

**Stale registry entries:** The dashboard automatically validates the server registry on each startup. If processes died without deregistering, you'll see `Registry: N live, M stale removed` printed to the console and logged. To manually trigger a cleanup: `aigon dev-server gc`.

---

## Opening Worktrees

After setting up a feature with worktrees, use `/aigon:feature-open` (or `aigon feature-open`) to quickly open them in your configured terminal:

```bash
# Open specific feature's worktree (picks most recent if multiple)
/aigon:feature-open 55
# or: aigon feature-open 55

# Open specific agent's worktree for a feature
/aigon:feature-open 55 cc
# or: aigon feature-open 55 cc

# Open all Fleet agents side-by-side (Warp split panes)
/aigon:feature-open 55 --all
# or: aigon feature-open 55 --all

# Open multiple features side-by-side (parallel mode)
/aigon:feature-open 100 101 102 --agent=cc
# or: aigon feature-open 100 101 102 --agent=cc

# Override terminal for this invocation
/aigon:feature-open 55 cc --terminal=code
# or: aigon feature-open 55 cc --terminal=code
```

### Terminal Behavior

- **Warp**: Opens a new tab, sets the working directory, and automatically runs the agent CLI with the `feature-do` slash command. Fleet (`--all`) and parallel modes open split panes. Each pane echoes its port label on launch (e.g., `🔌 Claude — Port 3401`). Panes are ordered by port offset (cc, gg, cx, cu).
- **tmux**: Creates named, persistent sessions (e.g., `aigon-f55-cc`) that survive terminal closes. Detach with `Ctrl-b d` and reattach anytime. Fleet mode creates one session per agent. Configure `tmuxApp` to choose which terminal app hosts the tmux attach (see below).
- **VS Code / Cursor**: Opens the folder; you'll need to run the agent command manually (shown in output). Split pane modes print commands for manual setup.
- **Terminal.app**: Opens a new Terminal.app window with the agent command.

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
aigon config set fleet.testInstructions "run npm test"

# Get values (shows where the value comes from)
aigon config get terminal                   # → warp (from ~/.aigon/config.json)
aigon config get profile                    # → web (from .aigon/config.json)

# Show config
aigon config show                           # Merged effective config (all levels)
aigon config show --global                  # Global config only
aigon config show --project                 # Project config only

# View model configuration
aigon config models                         # Show resolved models for all agents
```

### Global Config

```bash
aigon config init --global
```

Creates `~/.aigon/config.json`:

```json
{
  "terminal": "warp",
  "tmuxApp": "terminal",
  "agents": {
    "cc": { "cli": "claude", "implementFlag": "--permission-mode acceptEdits" },
    "cu": { "cli": "agent", "implementFlag": "--force" },
    "gg": { "cli": "gemini", "implementFlag": "--yolo" },
    "cx": { "cli": "codex", "implementFlag": "" }
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

- `terminal`: Default terminal for `feature-open`. Options: `warp` (auto-runs agent), `code` (VS Code), `cursor`, `terminal` (Terminal.app), `tmux` (persistent sessions)
- `tmuxApp`: Terminal app used to host tmux sessions. Options: `terminal` (Terminal.app, default), `iterm2` (iTerm2 with native `tmux -CC` integration — tmux windows become native tabs with scrollback, Cmd+F search, and trackpad scrolling). Only applies when `terminal` is set to `tmux`.
- `profile`: Project profile (`web`, `api`, `ios`, `android`, `library`, `generic`)
- `agents.{id}.cli`: Override the CLI command for each agent
- `agents.{id}.implementFlag`: Override CLI flags to control permission prompts
- `fleet.testInstructions`: Custom test instructions for Fleet mode

### CLI Flag Overrides

By default, Aigon uses "yolo mode" flags that auto-approve commands:
- **cc** (Claude): `--permission-mode acceptEdits` (auto-edits, prompts for risky Bash)
- **cu** (Cursor): `--force` (auto-approves commands)
- **gg** (Gemini): `--yolo` (auto-approves all)
- **cx** (Codex): interactive by default (`--full-auto` only in autonomous mode)

For stricter security (e.g., corporate environments):

```bash
aigon config set --global agents.cc.implementFlag ""
aigon config set --global agents.cu.implementFlag ""
```

Set `implementFlag` to `""` (empty string) to remove auto-approval flags and require manual permission prompts.

### Model Selection

Aigon supports per-agent, per-task model selection. Each agent can use different models for research, implementation, and evaluation.

```bash
# View all resolved model configurations
aigon config models

# Override a model for a specific agent/task (project-level)
aigon config set agents.cc.models.research haiku
aigon config set agents.gg.models.evaluate gemini-2.5-flash

# Override globally (user-wide)
aigon config set --global agents.cc.models.implement opus

# Per-session override via env var (highest priority)
AIGON_CC_RESEARCH_MODEL=haiku aigon config models
```

**Precedence order:** Env var > Project config > Global config > Template default

Env var pattern: `AIGON_{AGENT}_{TASK}_MODEL` where AGENT is `CC`, `GG`, `CX`, `CU` and TASK is `RESEARCH`, `IMPLEMENT`, `EVALUATE`.

**Note:** Cursor (`cu`) does not support `--model` CLI flag — model selection is UI-only. Models configured for Cursor are ignored.

### Precedence

**Priority order:** Env var > Project config > Global config > Defaults

Use `aigon config get <key>` to see which level a value comes from.

### Environment Variable Override

Set `AIGON_TERMINAL=code` to override the terminal for a single session.

---

## Multi-Agent Evaluation Examples

When running multi-agent arenas, use `/aigon:feature-eval <ID>` (or `aigon feature-eval <ID>`) to generate an evaluation template and compare implementations. Aigon automatically detects same-family evaluation bias and warns you.

### Evaluator Bias Detection

`feature-eval` warns if the evaluator shares a provider family with the implementer (e.g., Claude evaluating Claude's work). To suppress:

```bash
aigon feature-eval 10 --allow-same-model-judge
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
/aigon:feature-close 10 cx
# or: aigon feature-close 10 cx

# Or merge and adopt valuable improvements from losers
/aigon:feature-close 10 cx --adopt all
# or: aigon feature-close 10 cx --adopt cc gg

# Push losing branches to origin for safekeeping (optional)
/aigon:feature-cleanup 10 --push
# or: aigon feature-cleanup 10 --push

# Or just delete losing branches locally
/aigon:feature-cleanup 10
# or: aigon feature-cleanup 10
```

The `--adopt` flag prints diffs from losing agents after merging the winner. Review for extra tests, better error handling, documentation, and edge cases worth keeping.

---

## CLI Reference

### Research commands

| Command | Usage |
|---|---|
| Research Create | `aigon research-create <name>` |
| Research Prioritise | `aigon research-prioritise <name>` |
| Research Setup | `aigon research-start <ID> [agents...]` |
| Research Open | `aigon research-open <ID>` |
| Research Conduct | `aigon research-do <ID>` |
| Research Submit | `aigon research-submit [ID] [agent]` (signal findings complete) |
| Research Synthesize | `aigon research-synthesize <ID>` |
| Research Autopilot | `aigon research-autopilot <ID> [agents...]` (Fleet: spawn + monitor + synthesize) |
| Research Done | `aigon research-close <ID> [--complete]` |

### Feature commands

| Command | Usage |
|---|---|
| Feature Create | `aigon feature-create <name>` |
| Feature Now | `aigon feature-now <name>` (inbox match → prioritise + setup + implement; no match → create new) |
| Feature Prioritise | `aigon feature-prioritise <name>` |
| Feature Setup | `aigon feature-start <ID> [agents...]` |
| Feature Implement | `aigon feature-do <ID> [--agent=<id>] [--autonomous] [--auto-submit] [--no-auto-submit]` |
| Feature Submit | `aigon feature-submit` (agent-only: commit changes, write log, signal done) |
| Feature Validate | `aigon feature-validate <ID> [--dry-run]` (evaluate acceptance criteria) |
| Feature Eval | `aigon feature-eval <ID> [--force]` (Fleet only: compare implementations) |
| Feature Review | `aigon feature-review <ID>` |
| Feature Done | `aigon feature-close <ID> [agent] [--adopt <agents...\|all>]` |
| Feature Cleanup | `aigon feature-cleanup <ID> [--push]` |
| Feature Reset | `aigon feature-reset <ID>` |
| Feature Autopilot | `aigon feature-autopilot <ID> [agents...]` (Fleet: setup + spawn + monitor + eval) |
| Feature Autopilot Stop | `aigon feature-autopilot stop <ID>` |
| Feature Autopilot Attach | `aigon feature-autopilot attach <ID> <agent>` |
| Worktree Open | `aigon feature-open <ID> [agent] [--terminal=<type>]` |
| Worktree Open (Fleet) | `aigon feature-open <ID> --all` |
| Worktree Open (Parallel) | `aigon feature-open <ID> <ID>... [--agent=<code>]` |
| Sessions Close | `aigon sessions-close <ID>` (kill all agent sessions for a feature) |

### Feedback commands

| Command | Usage |
|---|---|
| Feedback Create | `aigon feedback-create "<title>"` |
| Feedback List | `aigon feedback-list [--inbox\|--triaged\|--actionable\|--all] [--type <type>] [--severity <severity>] [--tag <tag>]` |
| Feedback Triage | `aigon feedback-triage <ID> [--type <type>] [--severity <severity>] [--tags <csv>] [--status <status>] [--duplicate-of <ID>] [--apply --yes]` |

### Visualization commands

| Command | Usage |
|---|---|
| Board | `aigon board` |
| Board (List View) | `aigon board --list` |
| Board (Filtered) | `aigon board [--features\|--research] [--active\|--all\|--inbox\|--backlog\|--done]` |
| Board (No hints) | `aigon board --no-actions` |

### Agent status commands

| Command | Usage |
|---|---|
| Agent Status (set) | `aigon agent-status <implementing\|waiting\|submitted>` |
| Status (view) | `aigon status` (all in-progress features) |
| Status (view) | `aigon status <ID>` (per-agent table for one feature) |

### Dashboard commands

| Command | Usage |
|---|---|
| Dashboard Start | `aigon dashboard start [--port N]` |
| Dashboard Stop | `aigon dashboard stop` |
| Dashboard Status | `aigon dashboard status` |
| Dashboard Open | `aigon dashboard open` |
| Dashboard Add | `aigon dashboard add [path]` |
| Dashboard Remove | `aigon dashboard remove [path]` |
| Dashboard List | `aigon dashboard list` |
| Terminal Focus | `aigon terminal-focus <featureId> [agent]` |

### Dev server and proxy commands

| Command | Usage |
|---|---|
| Proxy Install | `aigon proxy install` (one-time: system daemon on port 80) |
| Proxy Start/Stop/Status | `aigon proxy <start\|stop\|status\|uninstall>` |
| Dev Server Start | `aigon dev-server start [--port N] [--open]` |
| Dev Server Start (register only) | `aigon dev-server start --register-only` |
| Dev Server Stop | `aigon dev-server stop [serverId]` |
| Dev Server Open | `aigon dev-server open` (open URL in browser) |
| Dev Server List | `aigon dev-server list` |
| Dev Server Logs | `aigon dev-server logs [-f] [-n N]` |
| Dev Server GC | `aigon dev-server gc` |
| Dev Server URL | `aigon dev-server url` |

### Conductor commands

| Command | Usage |
|---|---|
| Conduct | `aigon conduct <ID> [agents...]` (start arena: setup, spawn, monitor, eval) |
| Conduct Status | `aigon conduct status [ID]` |

### Deploy commands

| Command | Usage |
|---|---|
| Deploy | `aigon deploy` (run configured deploy command) |
| Deploy Preview | `aigon deploy --preview` (run configured preview command) |

### Utility commands

| Command | Usage |
|---|---|
| Init | `aigon init` |
| Install Agent | `aigon install-agent <cc\|gg\|cx\|cu> [more...]` |
| Update | `aigon update` |
| Seed Reset | `aigon seed-reset <repo-path> [--dry-run] [--force]` |
| Hooks | `aigon hooks [list]` |
| Config | `aigon config <init\|set\|get\|show\|models> [--global\|--project]` |
| Profile | `aigon profile [show\|set\|detect]` |
| Doctor | `aigon doctor [--register]` |
| Next | `aigon next` (agent-only: suggest next workflow action) |
| Help | `aigon help` |

---

## Agent Slash Commands

The command set is consistent across agents. Differences are only command prefix and storage location.

### Claude / Gemini (`/aigon:`)

| Slash Command | Description |
|---|---|
| `/aigon:feature-create <name>` | Create a feature spec |
| `/aigon:feature-now <name>` | Fast-track: create + setup + implement |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-start <ID> [agents...]` | Setup Drive or Fleet |
| `/aigon:feature-do <ID> [--autonomous]` | Implement feature |
| `/aigon:feature-submit` | Commit changes, write log, signal done |
| `/aigon:feature-eval <ID>` | Generate Fleet comparison |
| `/aigon:feature-review <ID>` | Cross-agent code review |
| `/aigon:feature-close <ID> [agent] [--adopt]` | Merge and complete |
| `/aigon:feature-cleanup <ID> [--push]` | Cleanup worktrees |
| `/aigon:feature-open [ID] [agent]` | Open worktree(s) |
| `/aigon:research-create <name>` | Create research topic |
| `/aigon:research-prioritise <name>` | Prioritise research |
| `/aigon:research-start <ID> [agents...]` | Setup research |
| `/aigon:research-do <ID>` | Write findings |
| `/aigon:research-synthesize <ID>` | Compare findings |
| `/aigon:research-close <ID>` | Complete research |
| `/aigon:feedback-create <title>` | Create feedback |
| `/aigon:feedback-list [filters...]` | List feedback |
| `/aigon:feedback-triage <ID>` | Triage feedback |
| `/aigon:board` | Show Kanban board |
| `/aigon:next` | Suggest next action |
| `/aigon:help` | Show commands |

### Codex (`/prompts:aigon-`)

Same commands as above with `/prompts:aigon-` prefix (e.g. `/prompts:aigon-feature-do 42`).

### Cursor (`/aigon-`)

Same commands as above with `/aigon-` prefix (e.g. `/aigon-feature-do 42`).

---

## Contributing / Developing Aigon

If you're working on Aigon itself, be aware of the template system:

- **Source of truth**: `templates/generic/commands/` and `templates/generic/docs/`
- **Working copies**: `.claude/commands/`, `.cursor/commands/`, `.gemini/commands/` (gitignored, generated)

The command directories (`.claude/commands/`, `.cursor/commands/`, `.gemini/commands/`) are gitignored because they're generated from templates during `aigon install-agent`. Settings files (`.claude/settings.json`, `.cursor/cli.json`, etc.) should be committed so worktrees inherit them.

### Development Workflow

1. Edit templates in `templates/generic/commands/`
2. Run `aigon update` or `aigon install-agent cc` to regenerate working copies
3. Test the commands in your agent session
4. Commit only the template changes (the working copies stay local)

### What `install-agent` Writes (and What It Doesn't)

For the full per-agent file listing and context delivery details, see [README — Installation, Agents, and Updates](README.md#installation-agents-and-updates).

**Key points for contributors:**

- `install-agent` writes **only aigon-owned files** — never touches `CLAUDE.md` or `AGENTS.md` (after initial scaffold).
- Command files (`.claude/commands/`, `.cursor/commands/`, `.gemini/commands/`) are **gitignored** — regenerated from templates.
- Settings files (`.claude/settings.json`, `.cursor/cli.json`, `.gemini/settings.json`, etc.) **should be committed** so worktrees inherit agent configurations.

### Code Module Structure

The CLI is split into focused domain modules. When modifying behaviour, look in the relevant module:

| Module | What lives there |
|--------|-----------------|
| `lib/proxy.js` | Caddy management, port allocation, dev-proxy registry, route reconciliation |
| `lib/dashboard-server.js` | HTTP server, status polling, WebSocket relay, macOS notifications, action dispatch |
| `lib/worktree.js` | Worktree creation, permissions, tmux sessions, terminal launching (iTerm2, Warp) |
| `lib/config.js` | Global/project config load/save, profile detection, agent CLI config, editor detection |
| `lib/templates.js` | Template reading, command registry, scaffolding, content generation |
| `lib/utils.js` | Shared utilities: hooks system, YAML parsers, spec CRUD, analytics, version, deploy |
| `lib/git.js` | All git operations — single source of truth |
| `lib/state-machine.js` | Action modes and valid state transitions for dashboard |
| `lib/commands/shared.js` | Thin factory (~150 lines) — builds `ctx`, composes domain files, hosts deprecated aliases |
| `lib/commands/feature.js` | All `feature-*` handlers and `sessions-close` |
| `lib/commands/research.js` | All `research-*` handlers |
| `lib/commands/feedback.js` | `feedback-create`, `feedback-list`, `feedback-triage` |
| `lib/commands/infra.js` | `conductor`, `dashboard`, `terminal-focus`, `board`, `proxy-setup`, `dev-server`, `config`, `hooks`, `profile` |
| `lib/commands/setup.js` | `init`, `install-agent`, `check-version`, `update`, `project-context`, `doctor` |
| `lib/commands/misc.js` | `agent-status`, `status`, `deploy`, `next`, `help` |

Each module `require()`s only what it needs. All command domain files receive dependencies via a `ctx` object rather than flat destructuring.

### Adding a new command

1. Identify which domain the command belongs to (feature, research, infra, setup, misc, or feedback).
2. Open `lib/commands/<domain>.js` and add a new key to the returned commands object:
   ```js
   'my-command': (args) => {
       const { PATHS } = ctx.utils;
       const branch = ctx.git.getCurrentBranch();
       // ...
   },
   ```
3. Add it to the `names` array in that file's `create<Domain>Commands` backward-compat wrapper.
4. Register it in `lib/templates.js` if it needs a slash-command template (add to the registry map).
5. Run `npm test` to confirm nothing broke.

---

📘 **For quick reference and getting started, return to the main [README.md](../README.md)**
