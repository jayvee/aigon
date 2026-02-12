# Aigon

**A lightweight, spec-driven framework for AI-native software engineering.**

Aigon is a **100% file-based system** that uses simple folder and file naming conventions to guide AI agents through a clear **Research → Feature Specification → Code** loop. It requires **no external databases, servers or integration to work tracking tools**. Everything lives as text files in your repository.

---

## Why Aigon?

Aigon solves a fundamental problem with AI-assisted development: **your workflow shouldn't depend on a single vendor**.

- **CLI-based, not IDE-locked** — Aigon works from any terminal, with any editor. No proprietary IDE extensions or cloud dashboards required.
- **Vendor-independent** — Use Claude Code, Gemini CLI, Codex, Cursor, or any combination. Switch agents freely without changing your workflow.
- **No lock-in** — Every spec, log, evaluation, and decision is a Markdown file in your repo. If you stop using Aigon, you keep everything.
- **Works with any agent** — Aigon's slash commands and CLI translate to the same workflow regardless of which AI agent you're using.

### Your Context Lives in Your Repo

Unlike third-party tools where context is locked in their servers, Aigon stores all feature specs, research topics, implementation logs, and evaluations **directly in your codebase**. This means:

- AI agents can read previous specs, decisions, and evaluations to inform future work
- Your team has full visibility into what was researched, decided, and why
- `git log` shows the complete history of your AI-assisted development
- New team members (human or AI) get immediate context from the `docs/specs/` folder

### Aigon Builds Aigon

This repository itself uses Aigon for its own development. Browse `docs/specs/` to see real feature specs, research topics, implementation logs, and evaluations as living examples of the workflow in action.

![Aigon specs folder structure](docs/images/aigon-specs-folder-structure.png)

---

## Table of Contents

1. [Why Aigon?](#why-aigon)
2. [Quick Start](#quick-start)
3. [Core Philosophy](#core-philosophy)
4. [The Specs Architecture](#the-specs-architecture)
5. [The Workflow](#the-workflow)
6. [Installation & Setup](#installation--setup)
7. [Project-Specific Agent Instructions](#project-specific-agent-instructions)
8. [CLI Reference](#cli-reference)
9. [Hooks](#hooks)
10. [Agent Slash Commands](#agent-slash-commands)
11. [Multi-Agent Evaluation](#multi-agent-evaluation)
12. [Workflow Examples](#workflow-examples)
13. [Contributing / Developing Aigon](#contributing--developing-aigon)

---

## Quick Start

The fastest path from idea to implementation:

```
> /aigon:feature-now dark-mode
```

This creates a spec, assigns an ID, sets up a branch, and starts implementation — all in one step. Write the spec and implement in a single session.

When you're done:

```
> /aigon:feature-done 55
```

For the full workflow with more control, see [The Workflow](#the-workflow) below.

---

## Core Philosophy

Aigon implements spec-driven AI development, where your specs are self-contained in your codebase and the workflow is implemented by simple shell scripts or agent commands.

Aigon provides this structure via Git and the filesystem:
* **State-as-Folders:** The status of a task is defined by *where it lives* (`inbox`, `backlog`, `in-progress`), not by a separate database record.
* **Decoupled Lifecycles:** Research and Features are separate entities. Research explores *what* to build; Features define *how* to build it.
* **Traceable History:** All agent conversations and implementation attempts are preserved as Markdown files within the repository itself.

Aigon derives its name from the fusion of "AI" and the ancient Greek concept of Agon (ἀγών), which signifies a **contest**, **struggle**, or gathering to prove one's merit. This reflects the framework's core philosophy: a structured arena where multiple AI models compete to interpret specifications and produce the highest quality code.

---

## The Specs Architecture

All workflow state is maintained in a strictly structured directory called **`./docs/specs`**. This folder (fully compatible with external knowledge tools like Obsidian) serves as the project's single source of truth.

The architecture separates concerns into distinct, state-driven folders:

* **Primary Domains:** `./docs/specs/research-topics` (Exploring options for building something) and `docs/specs/features` (Specific features to be built).
* **State Folders (Kanban):** Numbered for visual ordering: `01-inbox`, `02-backlog`, `03-in-progress`, `04-in-evaluation`, `05-done`, `06-paused`.
* **Documentation:** `./docs/specs/logs` (stores implementation logs) and `./docs/specs/evaluations` (stores LLM Judge reports).
* **History:** The `./docs/specs/logs/selected` folder contains the final, merged documentation, and `./docs/specs/logs/alternatives` contains the logs from the losing agents.

### Naming Conventions
* **Drafts:** `feature-description.md` (Unprioritized, in `01-inbox`)
* **Prioritised:** `feature-55-description.md` (Global Sequential ID assigned on prioritization)
* **Multi-Mode:** `../feature-55-cc-description` (Has a specific agent 2 letter code to indicate agent specific content)

---

## The Workflow

### 1. Research Lifecycle
Used for exploring complex topics before writing code. Files transition within the `./docs/specs/research-topics` folder. Research supports both **solo mode** (single agent) and **arena mode** (multiple agents with different perspectives).

#### 1.1 Solo Mode (Single Agent)
* **Create:** `/aigon:research-create "API Design"` creates a templated topic in `/01-inbox`. The agent **explores the codebase** before writing the topic to understand relevant existing code and constraints.
* **Prioritise:** `/aigon:research-prioritise api-design` moves it to `/02-backlog` and assigns a global ID.
* **Setup:** `aigon research-setup 05` moves to `/03-in-progress`.
* **Execute:** `/aigon:research-conduct 05` — agent reads the topic file, writes findings and recommendations directly into the document.
* **Done:** `aigon research-done 05` moves to `/04-done`.
* **Output:** The research file becomes a complete record, with suggested features in the Output section.

#### 1.2 Arena Mode (Multi-Agent Research)
Run multiple agents to get diverse perspectives on a research topic.

* **Create:** `/aigon:research-create "API Design"` creates a templated topic in `/01-inbox`. The agent **explores the codebase** first.
* **Prioritise:** `/aigon:research-prioritise api-design` moves it to `/02-backlog` and assigns a global ID.
* **Setup Arena:** `aigon research-setup 05 cc gg cx`
    * Moves topic to `/03-in-progress`.
    * Creates **separate findings files** for each agent in `logs/`:
        * `research-05-cc-findings.md` (Claude)
        * `research-05-gg-findings.md` (Gemini)
        * `research-05-cx-findings.md` (Codex)
* **Execute:** Run `/aigon:research-conduct 05` in each agent session.
    * Each agent writes ONLY to their own findings file.
    * Agents must NOT run `research-done` (user handles synthesis).
* **Open Side-by-Side:** `aigon research-open 05` opens all arena agents in Warp split panes, each pre-loaded with the research-conduct command.
* **Synthesize:** Run `/aigon:research-synthesize 05` with an agent to:
    * Read and compare ALL agents' findings
    * Present a synthesis with recommendations
    * Ask you which features to include (via chat)
    * Update the main research doc with your selections
    * **Tip:** Use a different model than those that conducted the research for unbiased synthesis
* **Complete:** `aigon research-done 05 --complete` moves to `/04-done`.
* **Output:** The main research file contains the synthesized recommendation, with findings files preserved in `logs/`.

### 2. Feature Lifecycle
Used for shipping code based on a defined spec. Files transition within the `./docs/specs/features` folder.

#### 2.1 Fast-Track (Solo Branch)

For features where you want to go from idea to implementation immediately:

* **Now:** `/aigon:feature-now dark-mode` — creates spec directly in `/in-progress`, assigns an ID, creates a solo branch, and commits atomically. Then write the spec and implement in one session.
* **Done:** `/aigon:feature-done <ID>` merges and completes.

This skips the inbox/backlog/setup steps entirely.

#### 2.2 Solo Mode (Single Agent)

Solo mode supports two workspace styles: **branch** (work in the current repo) or **worktree** (isolated directory for parallel development).

1.  **Create:** `/aigon:feature-create "Dark Mode"` creates a templated spec in `/inbox`.
    * The agent **explores the codebase** before writing the spec to understand existing architecture, patterns, and constraints.
2.  **Prioritise:** `/aigon:feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Setup:**
    * **Branch mode:** `aigon feature-setup 108` — creates a Git branch (`feature-108-dark-mode`) in the current repo.
    * **Worktree mode:** `aigon feature-setup 108 cc` — creates an isolated worktree at `../<repo>-worktrees/feature-108-cc-dark-mode`, ideal for working on multiple features in parallel.
    * Both modes auto-create a blank Implementation Log template.
4.  **Implement:** `/aigon:feature-implement 108` in the agent (or from the worktree).
    * Agent reads the feature spec and creates **tasks from the acceptance criteria** for progress tracking.
    * Agent codes the solution and *must* fill out the Implementation Log.
5.  **Evaluate (Optional):** `/aigon:feature-eval 108`
    * Creates code review checklist for the implementation.
6.  **Cross-Agent Review (Optional):** Have a different agent review the code and commit fixes:
    * Open a session with a different agent (e.g., Codex if Claude implemented)
    * Run `/aigon:feature-review 108`
    * The reviewing agent reads the spec, reviews `git diff main...HEAD`, and commits targeted fixes with `fix(review):` prefix
    * Review the fix commits before proceeding
7.  **Finish:** `/aigon:feature-done 108`
    * Merges the branch and archives the log.
    * For solo worktree mode, the agent is auto-detected — no need to specify it.

#### 2.3 Arena Mode (Multi-Agent Competition)

Run multiple agents in competition to find the optimal solution.

1.  **Create:** `/aigon:feature-create "Dark Mode"` creates a templated spec in `/inbox`.
    * The agent **explores the codebase** before writing the spec.
2.  **Prioritise:** `/aigon:feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Setup Arena:** `aigon feature-setup 108 cc gg cx`
    * Moves Spec to `/03-in-progress`.
    * Creates agent-specific **Git Branches** (`feature-108-cc-dark-mode`, `feature-108-gg-dark-mode`, `feature-108-cx-dark-mode`).
    * Creates **Git Worktrees** in a grouped folder:
        * `../<repo>-worktrees/feature-108-cc-dark-mode` (Claude)
        * `../<repo>-worktrees/feature-108-gg-dark-mode` (Gemini)
        * `../<repo>-worktrees/feature-108-cx-dark-mode` (Codex)
    * **Auto-creates** blank Implementation Log templates in each worktree.
    * **STOPS** - does not implement (user must open each worktree separately).
4.  **Implement:** Open all worktrees side-by-side:
    ```
    aigon worktree-open 108 --all
    ```
    * With Warp: opens all agents side-by-side and auto-starts each.
    * Single agent: `aigon worktree-open 108 cc` opens one worktree.
    * With VS Code: `aigon worktree-open 108 cc --terminal=code` opens the folder; run the agent manually.

    ![Warp arena split panes](docs/images/aigon-warp-arena-split.png)

    * Each agent builds the feature independently in their isolated worktree.
    * Each agent creates **tasks from the acceptance criteria** and *must* fill out their Implementation Log.
5.  **Cross-Agent Review (Optional):** Before evaluation, have different agents review each implementation:
    * In each worktree, open a session with a different agent
    * Run `/aigon:feature-review 108`
    * Reviewing agent commits fixes with `fix(review):` prefix
6.  **Evaluate:** Back in the main folder, switch to an eval model (eg sonnet) and run `/aigon:feature-eval 108`
    * Moves the feature to `/in-evaluation`.
    * Creates comparison template with all implementations.

    ![Feature evaluation output](docs/images/aigon-feature-eval-output.png)

7.  **Judge:** Review and compare solutions, fill in the evaluation.
8.  **Merge Winner:**
    ```bash
    aigon feature-done 108 cc
    ```
    * Merges winner's branch.
    * Moves winning agent's log to `logs/selected`.
    * Moves losing agent's logs to `logs/alternatives` (preserving history).
    * Cleans up winner's worktree.
9.  **Cleanup Losers:**
    ```bash
    aigon feature-cleanup 108 [--push]
    ```
    * Removes losing worktrees and branches.
    * Optional `--push` flag pushes branches to origin before deleting.

---

## Installation & Setup

### 1. Install the CLI
First, clone this repository and use `npm link` to make the `aigon` command globally available.

```bash
git clone https://github.com/yourname/aigon.git
cd aigon
npm install
npm link
```

### 2. Initialize Your Project
Navigate to your project's root directory and run `aigon init`. This will create the necessary `docs/specs` directory structure.

```bash
cd /path/to/your/project
aigon init
```

![aigon init output](docs/images/aigon-init-output.png)

### 3. Install Agent Configurations
To integrate Aigon with your AI agents, run `aigon install-agent`. This command generates the required configuration files for the specified agents. You can install multiple agents at once.

```bash
# Install single agent
aigon install-agent cc

# Install multiple agents at once
aigon install-agent cc gg cx cu
```

![Multi-agent install output](docs/images/aigon-install-agents.png)

**Supported Agents:**
| Agent | Alias | CLI Command | Description |
|-------|-------|-------------|-------------|
| `cc` | `claude` | `claude` | Claude Code |
| `gg` | `gemini` | `gemini` | Gemini CLI |
| `cx` | `codex` | `codex` | Codex |
| `cu` | `cursor` | `agent` | Cursor (via `agent` CLI / composer model) |

**Generated Files:**
```
your-project/
├── docs/
│   ├── development_workflow.md    # Shared workflow documentation
│   └── agents/
│       ├── claude.md              # Claude-specific instructions
│       ├── gemini.md              # Gemini-specific instructions
│       ├── codex.md               # Codex-specific instructions
│       └── cursor.md              # Cursor-specific instructions
├── CLAUDE.md                      # Root file for Claude Code
├── GEMINI.md                      # Root file for Gemini CLI
├── .claude/                       # Claude skills & slash commands (aigon/ subdirectory)
├── .gemini/                       # Gemini command files
├── .codex/                        # Codex prompts & config
│   ├── prompt.md                  # Project-level Codex instructions
│   └── config.toml                # Codex configuration
└── .cursor/                       # Cursor commands & config
    ├── commands/                  # Slash commands for Cursor
    └── cli.json                   # CLI permissions configuration
```

**Note:** Codex also installs global prompts in `~/.codex/prompts/` (shared across all projects).

**Important:** You must commit the generated configuration files to Git. This ensures that when `aigon` creates a new git worktree, the agent configurations are available in that isolated environment.

### 4. Updating Aigon

To update all Aigon files to the latest version:

```bash
aigon update
```

This command re-installs all detected agents while **preserving any custom content** you've added to root files (CLAUDE.md, GEMINI.md, etc.) and agent docs.

**How it works:** Aigon wraps its managed content in `<!-- AIGON_START -->` and `<!-- AIGON_END -->` markers. Anything you write **outside** these markers is yours and will never be overwritten:

```markdown
# My Project Instructions          ← Your custom content (preserved)

## Testing                          ← Your custom content (preserved)
Run `npm test` for unit tests.

<!-- AIGON_START -->
## Aigon                            ← Managed by Aigon (updated)

This project uses the Aigon workflow.
- Claude-specific notes: `docs/agents/claude.md`
- Development workflow: `docs/development_workflow.md`
<!-- AIGON_END -->

## Code Style                       ← Your custom content (preserved)
We use Prettier with 2-space tabs.
```

![AIGON_START/END markers](docs/images/aigon-update-markers.png)

### 5. Configure Global Settings (Optional)

Create a global configuration file to customize terminal and agent CLI settings:

```bash
aigon config init
```

This creates `~/.aigon/config.json`:

```json
{
  "terminal": "warp",
  "agents": {
    "cc": { "cli": "claude" },
    "cu": { "cli": "agent" },
    "gg": { "cli": "gemini" },
    "cx": { "cli": "codex" }
  }
}
```

**Configuration options:**
- `terminal`: Default terminal for `worktree-open`. Options: `warp` (auto-runs agent), `code` (VS Code), `cursor`
- `agents.{id}.cli`: Override the CLI command for each agent

**Environment variable override:** Set `AIGON_TERMINAL=code` to override the terminal for a single session.

### 6. Project Profiles (Optional)

Aigon auto-detects your project type and adapts arena behavior accordingly. For non-web projects (iOS, Android, libraries), this means no PORT assignment, no `.env.local` creation, and appropriate test instructions in templates.

**Auto-detection** checks for:
| Profile | Detected By |
|---------|-------------|
| `ios` | `*.xcodeproj`, `*.xcworkspace`, `Package.swift` (root or `ios/` subdir) |
| `android` | `build.gradle`, `build.gradle.kts` (root or `android/` subdir) |
| `web` | `package.json` with `scripts.dev` + framework config (`next.config.*`, `vite.config.*`, etc.) |
| `api` | `manage.py`, `app.py`, `main.go`, `server.js`, `server.ts` |
| `library` | `Cargo.toml`, `go.mod`, `pyproject.toml`, `setup.py`, or `package.json` without dev script |
| `generic` | Fallback when nothing matches |

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

**Profile behavior:**
- **`web` / `api`**: Dev server enabled, agent-specific ports assigned, `.env.local` created in worktrees
- **`ios` / `android` / `library` / `generic`**: No dev server, no PORT, templates show project-appropriate test instructions

### 7. Opening Worktrees

After setting up a feature with worktrees, use `worktree-open` to quickly open them in your configured terminal:

```bash
# Open specific feature's worktree (picks most recent if multiple)
aigon worktree-open 55

# Open specific agent's worktree for a feature
aigon worktree-open 55 cc

# Open all arena agents side-by-side (Warp split panes)
aigon worktree-open 55 --all

# Open multiple features side-by-side (parallel mode)
aigon worktree-open 100 101 102 --agent=cc

# Override terminal for this invocation
aigon worktree-open 55 cc --terminal=code
```

![Worktree open output](docs/images/aigon-worktree-open.png)

**Terminal behavior:**
- **Warp**: Opens a new tab, sets the working directory, and automatically runs the agent CLI with the `feature-implement` slash command. Arena (`--all`) and parallel modes open split panes.
- **VS Code / Cursor**: Opens the folder; you'll need to run the agent command manually (shown in output). Split pane modes print commands for manual setup.

---

## Project-Specific Agent Instructions

Aigon generates root instruction files (`CLAUDE.md`, `GEMINI.md`) and agent docs (`docs/agents/claude.md`, etc.) with managed content inside `<!-- AIGON_START/END -->` markers. You should add your project-specific instructions **outside** these markers.

### What to Customize

Add sections like these to your root files (e.g., `CLAUDE.md`):

```markdown
# Project Instructions

## Testing
Run `npm test` for unit tests.
Run `npm run test:e2e` for end-to-end tests.

## Build & Run
`npm run dev` starts the development server on port 3000.

## Dependencies
Run `npm ci` to install dependencies.

## Code Style
- Use TypeScript strict mode
- Prefer functional components with hooks
- Use Tailwind CSS for styling

<!-- AIGON_START -->
## Aigon
...managed content...
<!-- AIGON_END -->
```

### Tips

- **Root files** (`CLAUDE.md`, `GEMINI.md`) are read at the start of every agent session — put critical instructions here
- **Agent docs** (`docs/agents/claude.md`, etc.) contain agent-specific workflow details — customize if you have agent-specific build steps
- Running `aigon update` or `aigon install-agent` will update only the content between `AIGON_START/END` markers
- Your custom sections are preserved across updates

---

## CLI Reference

The `aigon` command automates state transitions and Git operations. The workflow uses a unified set of commands that work in both solo and arena modes.

### Feature Commands
| Command | Usage | Description |
| :--- | :--- | :--- |
| **Feature Create** | `aigon feature-create <name>` | Create a new feature spec in inbox |
| **Feature Now** | `aigon feature-now <name>` | Fast-track: create + prioritise + setup in one step (solo branch) |
| **Feature Prioritise** | `aigon feature-prioritise <name>` | Assign ID and move to backlog |
| **Feature Setup** | `aigon feature-setup <ID> [agents...]` | Setup for implementation. No agents: branch. 1 agent: solo worktree. 2+: arena |
| **Feature List** | `aigon feature-list [--flags]` | List features by status, mode, and location. Flags: `--all`, `--active`, `--inbox`, `--backlog`, `--done` |
| **Feature Implement** | `aigon feature-implement <ID>` | Auto-detects mode (branch, solo worktree, arena). Implements feature |
| **Feature Evaluate** | `aigon feature-eval <ID>` | Move to evaluation. Solo: code review checklist. Arena: comparison template |
| **Feature Review** | `aigon feature-review <ID>` | Cross-agent code review with fixes (use different agent than implementer) |
| **Feature Done** | `aigon feature-done <ID> [agent]` | Merge and complete. Solo worktree auto-detects agent. Arena: specify winner |
| **Feature Cleanup** | `aigon feature-cleanup <ID> [--push]` | Clean up arena mode worktrees and branches |

### Research Commands

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Research Create** | `aigon research-create <name>` | Creates a new research topic from template in `research-topics/inbox`. |
| **Research Prioritise** | `aigon research-prioritise <name>` | Promotes a research draft from `inbox` to `backlog` with a new ID. |
| **Research Setup** | `aigon research-setup <ID> [agents...]` | Setup research. Solo: no agents. Arena: creates findings files for each agent. |
| **Research Conduct** | `aigon research-conduct <ID>` | Conduct research. Agent writes findings (detects solo/arena mode). |
| **Research Done** | `aigon research-done <ID> [--complete]` | Complete research. Arena: shows interactive synthesis, `--complete` finalizes. |

### Utilities

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Init** | `aigon init` | Creates the `./docs/specs` directory structure in the current project. |
| **Install Agent** | `aigon install-agent <agents...>` | Generates agent configuration files. Accepts multiple agents: `cc`, `gg`, `cx`, `cu`. |
| **Update** | `aigon update` | Updates all Aigon files to latest version. Re-installs detected agents. Preserves custom content outside `AIGON_START/END` markers. |
| **Hooks List** | `aigon hooks [list]` | List all defined hooks from `docs/aigon-hooks.md`. |
| **Config** | `aigon config <init\|show>` | Manage global config at `~/.aigon/config.json`. |
| **Profile** | `aigon profile [show\|set\|detect]` | Manage project profile. Auto-detects or override with `set <type>`. |
| **Worktree Open** | `aigon worktree-open <ID> [agent] [--terminal=<type>]` | Open worktree in terminal with agent CLI. |
| **Worktree Open (Arena)** | `aigon worktree-open <ID> --all` | Open all arena worktrees side-by-side. |
| **Worktree Open (Parallel)** | `aigon worktree-open <ID> <ID>... [--agent=<code>]` | Open multiple features side-by-side. |
| **Research Open** | `aigon research-open <ID>` | Open all arena research agents side-by-side in terminal. |

---

## Hooks

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

## Agent Slash Commands

Each agent has its own slash command prefix. All agents support the same set of 19 commands.

### Claude Code

When you run `aigon install-agent cc`, it installs slash commands into `.claude/commands/aigon/`, giving them a clean `/aigon:` namespace in the slash menu. Commands include argument hints and destructive commands are protected from autonomous invocation.

![Claude Code slash command menu](docs/images/aigon-slash-commands-menu.png)

#### Features

| Slash Command | Description |
| :--- | :--- |
| `/aigon:feature-create <name>` | Create a new feature spec |
| `/aigon:feature-now <name>` | Fast-track: create + setup + implement in one step (solo branch) |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-setup <ID> [agents...]` | Setup for solo (no agents), solo worktree (1 agent), or arena (2+ agents) |
| `/aigon:feature-list` | List features by status, mode, and location |
| `/aigon:feature-implement <ID>` | Implement feature in current branch/worktree |
| `/aigon:feature-eval <ID>` | Create evaluation template (code review or comparison) |
| `/aigon:feature-review <ID>` | Cross-agent code review with fixes |
| `/aigon:feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon:feature-cleanup <ID>` | Clean up arena worktrees and branches |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/aigon:research-create <name>` | Create a new research topic |
| `/aigon:research-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:research-setup <ID> [agents...]` | Setup research (solo or arena mode) |
| `/aigon:research-conduct <ID>` | Conduct research (write findings) |
| `/aigon:research-synthesize <ID>` | Compare ALL agents' findings (arena mode - read-only analysis) |
| `/aigon:research-done <ID>` | Complete research (solo mode only - agents should NOT run in arena mode) |

#### Utilities

| Slash Command | Description |
| :--- | :--- |
| `/aigon:worktree-open [ID] [agent]` | Open worktree in terminal with agent CLI |
| `/aigon:research-open <ID>` | Open all arena research agents side-by-side in terminal |
| `/aigon:help` | Shows all available Aigon commands |

**Arena Mode Note:** In arena mode, agents write to their findings file and STOP. Use `research-synthesize` to have an agent compare all findings, then user runs `research-done` to select features.

### Gemini

When you run `aigon install-agent gg`, it installs slash commands into `.gemini/commands/aigon/` using TOML format.

#### Features

| Slash Command | Description |
| :--- | :--- |
| `/aigon:feature-create <name>` | Create a new feature spec |
| `/aigon:feature-now <name>` | Fast-track: create + setup + implement in one step (solo branch) |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-setup <ID> [agents...]` | Setup for solo (no agents), solo worktree (1 agent), or arena (2+ agents) |
| `/aigon:feature-list` | List features by status, mode, and location |
| `/aigon:feature-implement <ID>` | Implement feature in current branch/worktree |
| `/aigon:feature-eval <ID>` | Create evaluation template (code review or comparison) |
| `/aigon:feature-review <ID>` | Cross-agent code review with fixes |
| `/aigon:feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon:feature-cleanup <ID>` | Clean up arena worktrees and branches |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/aigon:research-create <name>` | Create a new research topic |
| `/aigon:research-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:research-setup <ID> [agents...]` | Setup research (solo or arena mode) |
| `/aigon:research-conduct <ID>` | Conduct research (write findings) |
| `/aigon:research-synthesize <ID>` | Compare ALL agents' findings (arena mode - read-only analysis) |
| `/aigon:research-done <ID>` | Complete research (solo mode only - agents should NOT run in arena mode) |

#### Utilities

| Slash Command | Description |
| :--- | :--- |
| `/aigon:worktree-open [ID] [agent]` | Open worktree in terminal with agent CLI |
| `/aigon:research-open <ID>` | Open all arena research agents side-by-side in terminal |
| `/aigon:help` | Shows all available Aigon commands |

**Arena Mode Note:** In arena mode, agents write to their findings file and STOP. Use `research-synthesize` to have an agent compare all findings, then user runs `research-done` to select features.

### Codex

When you run `aigon install-agent cx`, it installs slash commands to your **global** `~/.codex/prompts/` folder.

**Note:** Codex only supports global prompts (not project-level). This means the same Aigon commands are available across all your projects.

#### Features

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-feature-create <name>` | Create a new feature spec |
| `/prompts:aigon-feature-now <name>` | Fast-track: create + setup + implement in one step (solo branch) |
| `/prompts:aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/prompts:aigon-feature-setup <ID> [agents...]` | Setup for solo (no agents), solo worktree (1 agent), or arena (2+ agents) |
| `/prompts:aigon-feature-list` | List features by status, mode, and location |
| `/prompts:aigon-feature-implement <ID>` | Implement feature in current branch/worktree |
| `/prompts:aigon-feature-eval <ID>` | Create evaluation template (code review or comparison) |
| `/prompts:aigon-feature-review <ID>` | Cross-agent code review with fixes |
| `/prompts:aigon-feature-done <ID> [agent]` | Merge and complete feature |
| `/prompts:aigon-feature-cleanup <ID>` | Clean up arena worktrees and branches |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-research-create <name>` | Create a new research topic |
| `/prompts:aigon-research-prioritise <name>` | Assign ID and move to backlog |
| `/prompts:aigon-research-setup <ID> [agents...]` | Setup research (solo or arena mode) |
| `/prompts:aigon-research-conduct <ID>` | Conduct research (write findings) |
| `/prompts:aigon-research-synthesize <ID>` | Compare ALL agents' findings (arena mode - read-only analysis) |
| `/prompts:aigon-research-done <ID>` | Complete research (solo mode only - agents should NOT run in arena mode) |

#### Utilities

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-worktree-open [ID] [agent]` | Open worktree in terminal with agent CLI |
| `/prompts:aigon-research-open <ID>` | Open all arena research agents side-by-side in terminal |
| `/prompts:aigon-help` | Shows all available Aigon commands |

**Arena Mode Note:** In arena mode, agents write to their findings file and STOP. Use `research-synthesize` to have an agent compare all findings, then user runs `research-done` to select features.

### Cursor

When you run `aigon install-agent cu`, it installs slash commands to your project's `.cursor/commands/` folder.

**Note:** Cursor uses the `agent` CLI command (composer model) for terminal-based agent interactions. Commands are accessed by typing `/` in the Agent input.

#### Features

| Slash Command | Description |
| :--- | :--- |
| `/aigon-feature-create <name>` | Create a new feature spec |
| `/aigon-feature-now <name>` | Fast-track: create + setup + implement in one step (solo branch) |
| `/aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon-feature-setup <ID> [agents...]` | Setup for solo (no agents), solo worktree (1 agent), or arena (2+ agents) |
| `/aigon-feature-list` | List features by status, mode, and location |
| `/aigon-feature-implement <ID>` | Implement feature in current branch/worktree |
| `/aigon-feature-eval <ID>` | Create evaluation template (code review or comparison) |
| `/aigon-feature-review <ID>` | Cross-agent code review with fixes |
| `/aigon-feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon-feature-cleanup <ID>` | Clean up arena worktrees and branches |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/aigon-research-create <name>` | Create a new research topic |
| `/aigon-research-prioritise <name>` | Assign ID and move to backlog |
| `/aigon-research-setup <ID> [agents...]` | Setup research (solo or arena mode) |
| `/aigon-research-conduct <ID>` | Conduct research (write findings) |
| `/aigon-research-synthesize <ID>` | Compare ALL agents' findings (arena mode - read-only analysis) |
| `/aigon-research-done <ID>` | Complete research (solo mode only - agents should NOT run in arena mode) |

#### Utilities

| Slash Command | Description |
| :--- | :--- |
| `/aigon-worktree-open [ID] [agent]` | Open worktree in terminal with agent CLI |
| `/aigon-research-open <ID>` | Open all arena research agents side-by-side in terminal |
| `/aigon-help` | Shows all available Aigon commands |

**Arena Mode Note:** In arena mode, agents write to their findings file and STOP. Use `research-synthesize` to have an agent compare all findings, then user runs `research-done` to select features.

---

## Multi-Agent Evaluation

When running multi-agent arenas, use `/aigon:feature-eval <ID>` to generate an evaluation template and compare implementations. For unbiased evaluation, **use a different model as the evaluator** than the ones that wrote the code.

### Evaluator Model Recommendation

If using Claude as the evaluator, start it with a different model:

```bash
# If implementations were written by Opus, evaluate with Sonnet
claude --model sonnet

# Then run the evaluation command
/aigon:feature-eval 10
```

### Example Evaluation Output

Here's an example of what a multi-agent evaluation produces:

![Feature evaluation comparison](docs/images/aigon-feature-eval-output.png)

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
```

### After Evaluation

Once you've chosen a winner, merge their implementation:

```bash
# Merge the winning implementation
aigon feature-done 10 cx

# Push losing branches to origin for safekeeping (optional)
aigon feature-cleanup 10 --push

# Or just delete losing branches locally
aigon feature-cleanup 10
```

---

## Workflow Examples

### Solo Development (Fast-Track)

The simplest path — create, implement, and ship in one session:

<table>
<tr><td>

> **User:**
>
> `/aigon:feature-now dark-mode`

</td></tr>
<tr><td>

**Agent:**

```
⏺ Bash(aigon feature-now dark-mode)
  ⎿  ✅ Created: feature-72-dark-mode in 03-in-progress
     🌿 Branch: feature-72-dark-mode
     📝 Log: docs/specs/features/logs/feature-72-dark-mode-log.md
```

I've created feature 72 and set up a branch. Let me read the spec template and explore the codebase to write a comprehensive spec...

*[Agent writes spec, implements the feature, fills out the log]*

Implementation complete. Ready for your review.

> **Next:** `/aigon:feature-done 72`

</td></tr>
</table>

### Solo Development (Full Workflow)

For features that benefit from separate spec review and implementation phases:

<table>
<tr><td>

> **User:**
>
> `/aigon:feature-create "user-preferences-page"`

</td></tr>
<tr><td>

**Agent:**

```
⏺ Bash(aigon feature-create user-preferences-page)
  ⎿  ✅ Created: ./docs/specs/features/01-inbox/feature-user-preferences-page.md
```

*[Agent explores codebase and writes detailed spec]*

Created the spec. Review it and when you're ready:

> **Next:** `/aigon:feature-prioritise user-preferences-page`

</td></tr>
<tr><td>

> **User:**
>
> Looks good, prioritise it and set it up

</td></tr>
<tr><td>

**Agent:**

```
⏺ Bash(aigon feature-prioritise user-preferences-page)
  ⎿  ✅ Assigned ID: 73

⏺ Bash(aigon feature-setup 73)
  ⎿  🌿 Branch: feature-73-user-preferences-page
```

Ready for implementation.

> **Next:** `/aigon:feature-implement 73`

</td></tr>
</table>

### Arena Mode Competition

Three agents compete to implement the same feature:

<table>
<tr><td>

> **User:**
>
> Set up a bakeoff for feature 50 with cc cx gg

</td></tr>
<tr><td>

**Agent:**

```
⏺ Bash(aigon feature-setup 50 cc cx gg)
  ⎿  ✅ Moved spec to 03-in-progress
     🌿 Created worktree: ../myapp-worktrees/feature-50-cc-show-current-project
     🌿 Created worktree: ../myapp-worktrees/feature-50-cx-show-current-project
     🌿 Created worktree: ../myapp-worktrees/feature-50-gg-show-current-project
```

Arena setup complete. Open all agents side-by-side:

```bash
aigon worktree-open 50 --all
```

Each agent will independently implement the feature. When all are done, return here and run:

> **Next:** `/aigon:feature-eval 50`

</td></tr>
</table>

![Warp arena split panes](docs/images/aigon-warp-arena-split.png)

### Multi-Agent Research

Research a topic with multiple agents providing diverse perspectives:

<table>
<tr><td>

> **User:**
>
> `/aigon:research-create "State Management Options"`

</td></tr>
<tr><td>

**Agent:**

```
⏺ Bash(aigon research-create "State Management Options")
  ⎿  ✅ Created: ./docs/specs/research-topics/01-inbox/research-state-management-options.md
```

*[Agent explores codebase and writes research topic]*

> **Next:** `/aigon:research-prioritise state-management-options`

</td></tr>
<tr><td>

> **User:**
>
> Prioritise and set up arena with cc gg cx

</td></tr>
<tr><td>

**Agent:**

```
⏺ Bash(aigon research-prioritise state-management-options)
  ⎿  ✅ Assigned ID: 08

⏺ Bash(aigon research-setup 08 cc gg cx)
  ⎿  ✅ Created findings files:
     - research-08-cc-findings.md
     - research-08-gg-findings.md
     - research-08-cx-findings.md
```

Research arena is ready. Open all agents side-by-side:

```bash
aigon research-open 08
```

Each agent will conduct independent research. When all are done, synthesize with:

> **Next:** `/aigon:research-synthesize 08`

</td></tr>
</table>

### Worktree Workflow (Parallel Features)

Work on multiple features simultaneously with isolated worktrees:

<table>
<tr><td>

> **User:**
>
> Set up features 100, 101, and 102 as solo worktrees for cc

</td></tr>
<tr><td>

**Agent:**

```
⏺ Bash(aigon feature-setup 100 cc)
  ⎿  🌿 Worktree: ../myapp-worktrees/feature-100-cc-auth-flow

⏺ Bash(aigon feature-setup 101 cc)
  ⎿  🌿 Worktree: ../myapp-worktrees/feature-101-cc-dashboard

⏺ Bash(aigon feature-setup 102 cc)
  ⎿  🌿 Worktree: ../myapp-worktrees/feature-102-cc-notifications
```

Three worktrees ready. Open them all side-by-side:

```bash
aigon worktree-open 100 101 102 --agent=cc
```

Each opens in a separate Warp pane with Claude Code ready to implement.

</td></tr>
</table>

### Feature List

Check the status of all your features:

```
> /aigon:feature-list
```

![Feature list output](docs/images/aigon-feature-list.png)

---

## Contributing / Developing Aigon

If you're working on Aigon itself, be aware of the template system:

- **Source of truth**: `templates/generic/commands/` and `templates/generic/docs/`
- **Working copies**: `.claude/commands/`, `.cursor/commands/`, `.gemini/commands/` (gitignored, generated)

The agent directories (`.claude/`, `.cursor/`, etc.) and root files (`CLAUDE.md`, `GEMINI.md`) are gitignored because they're generated from templates during `aigon install-agent`.

**Development workflow:**
1. Edit templates in `templates/generic/commands/`
2. Run `aigon update` or `aigon install-agent cc` to regenerate working copies
3. Test the commands in your agent session
4. Commit only the template changes (the working copies stay local)

---
