# Aigon

<img src="assets/icon/aigon-icon.svg" width="64" height="64" alt="Aigon"/>

**Agent-first, CLI-capable, vendor-independent AI engineering workflows that keep your context in your repo.**

Aigon gives you a consistent spec workflow across Claude, Gemini, Codex, and Cursor without locking your team to one IDE or one model provider.

- **CLI based:** plain files + git + terminal commands
- **Vendor independent:** works across multiple agent ecosystems
- **Slash-command native:** use agent commands day to day, keep CLI as universal fallback
- **No lock-in:** your specs, logs, research, and evaluations remain in your repository

Aigon itself is built with Aigon. Browse `docs/specs/` in this repo to see real feature specs, implementation logs, research topics, and evaluations used to build and maintain the project.

```
docs/specs/
├── research-topics/            # Internal investigations (inbound funnel)
│   ├── 01-inbox/
│   ├── 02-backlog/
│   ├── 03-in-progress/
│   ├── 04-done/
│   │   ├── research-01-subdomains-for-multi-agent-mode.md
│   │   └── research-03-simplify-command-parameters.md
│   ├── 05-paused/
│   └── logs/
├── features/                   # Implementation specs (delivery pipeline)
│   ├── 01-inbox/
│   │   ├── feature-base-port-config.md
│   │   ├── feature-create-plugin.md
│   │   └── ...
│   ├── 02-backlog/
│   ├── 03-in-progress/
│   ├── 04-in-evaluation/
│   ├── 05-done/
│   │   ├── feature-01-support-hooks.md
│   │   ├── feature-13-feedback-foundation.md
│   │   ├── feature-14-feedback-triage-workflow.md
│   │   └── ...
│   ├── 06-paused/
│   ├── evaluations/
│   │   └── feature-14-eval.md
│   └── logs/
│       ├── selected/
│       └── alternatives/
├── feedback/                    # User/customer input (closes the loop)
│   ├── 01-inbox/               # New feedback awaiting triage
│   ├── 02-triaged/             # Classified and validated
│   ├── 03-actionable/          # Ready to promote to research/features
│   ├── 04-done/                # Resolved and closed
│   ├── 05-wont-fix/            # Reviewed and intentionally not actioned
│   └── 06-duplicate/           # Duplicates linked to canonical items
└── templates/
    ├── research-template.md
    ├── feature-template.md
    └── feedback-template.md
```

The **Aigon Dashboard** gives you a visual pipeline across all your repos — features, agents, and status at a glance:

![Aigon Dashboard — Fleet agents implementing in parallel](docs/images/aigon-dashboard-01-fleet-start.gif)

A terminal board view is also available via `aigon board`. See [Dashboard in Action](#dashboard-in-action) for the full Fleet workflow.

---

📘 **New to Aigon?** This README covers the essentials. For detailed workflows, hooks, and advanced configuration, see the [Complete Guide](GUIDE.md)

---

## Table of Contents

1. [Why Aigon](#why-aigon)
2. [Core Philosophy](#core-philosophy)
3. [Quick Start](#quick-start)
4. [Aigon Dashboard](#aigon-dashboard)
5. [Installation, Agents, and Updates](#installation-agents-and-updates)
6. [Workflow Overview & Examples](#workflow-overview)
7. [Terminal Setup](#terminal-setup-tmux--iterm2)
8. [Local Dev Proxy](#local-dev-proxy)
9. [Multi-Agent Evaluation](#multi-agent-evaluation)
10. [CLI Reference](GUIDE.md#cli-reference) (in Complete Guide)

---

## Why Aigon

Aigon is for teams that want AI acceleration without handing their project memory to a third-party platform.

### Context stays with your code

Everything is stored in your repo:

- **feedback items** (`docs/specs/feedback/`) — raw user/customer input with attribution
- **research topics** and findings (`docs/specs/research-topics/`) — internal investigations
- **feature specs** (`docs/specs/features/`) — implementation plans with acceptance criteria
- **implementation logs** (`docs/specs/features/logs/`) — what was built and why
- **evaluation reports** (`docs/specs/features/04-in-evaluation/`) — code reviews and comparisons

That history becomes reusable context for future AI sessions, code reviews, and onboarding. In contrast, tool-hosted chat history is typically siloed per vendor account and hard to reuse across tools.

### Complete product lifecycle: Research → Ideas → Features → Feedback (loop)

![Aigon lifecycle: Research and Feedback feed into Features, which flow through Build, Evaluate, and Ship, then loop back as user feedback](docs/images/aigon-lifecycle-loop.svg)

Aigon handles the **full lifecycle of changes**, creating a closed loop from exploration to shipped code and back:

1. **Research** (internal exploration) — Investigate technical possibilities, evaluate options, and synthesize recommendations before committing to implementation.

2. **Ideas** (feature specs) — Define what to build with acceptance criteria, informed by research findings.

3. **Features** (implementation + delivery) — Build, evaluate, and ship the code.

4. **Feedback** (external signal) — Capture user reports, support tickets, and customer requests from shipped features. Triage with AI assistance to classify, deduplicate, and route actionable items back into research or new features.

**The loop closes:** Feedback from end users spawns new research topics or features, creating an auditable trail:
- "This feature addresses feedback #42 and was informed by research #07"
- "Feedback #42 about the dark mode shipped in v2.1 resulted in feature #108"
- "Research #07 was triggered by feedback #35, #36, and #41"

This answers both "why did we build this?" (forward traceability) and "what happened to my request?" (backward traceability), keeping product decisions transparent and evidence-based.

### Built for real multi-agent workflows

Aigon uses four modes across two axes:

```
                    One Agent          Multi-Agent
                 ┌──────────────┬──────────────────┐
  Hands-on       │    Drive     │      Fleet       │
                 ├──────────────┼──────────────────┤
  Hands-off      │  Autopilot   │      Swarm       │
                 └──────────────┴──────────────────┘
                         Autonomous
```

- **Drive mode**: one agent, hands-on
- **Fleet mode**: multiple agents, hands-on competition
- **Autopilot mode**: one agent, hands-off autonomous loop
- **Swarm mode**: multiple agents, hands-off autonomous loop
- **Fleet research**: parallel findings plus synthesis (`research-setup` + `research-open` + `research-synthesize`)

---

## Core Philosophy

Aigon implements spec-driven AI development using Git and the filesystem as the foundation:

- **State-as-Folders:** Task status is defined by *where it lives* (`inbox`, `backlog`, `in-progress`), not by database records
- **Decoupled Lifecycles:** Research explores *what* to build; Features define *how* to build it
- **Traceable History:** All agent conversations and implementation attempts are preserved as Markdown files in your repository

This approach keeps your workflow transparent, portable, and fully version-controlled.

---

## The Specs Architecture

All workflow state lives in `./docs/specs`, organized into three pillars:

**Inbound funnels (what to build):**
- `feedback/` — Raw user/customer input requiring triage and routing
- `research-topics/` — Internal investigations exploring technical possibilities

**Delivery pipeline (how to build it):**
- `features/` — Implementation specs with acceptance criteria

**Lifecycle folders (Kanban):**
Each pillar uses folder-based status:
- `01-inbox/` — New, unprioritized items
- `02-backlog/` — Prioritized, ready to start (research/features only)
- `02-triaged/` — Classified and validated (feedback only)
- `03-in-progress/` — Currently being worked on
- `03-actionable/` — Ready to promote to research/features (feedback only)
- `04-in-evaluation/` — Completed, being reviewed
- `05-done/` — Finished and merged
- `06-paused/` — Temporarily on hold

**Documentation:**
- `logs/` — Implementation logs (selected winners + alternatives)
- `evaluations/` — Fleet comparison reports

**Naming conventions:**
- Drafts: `feature-description.md` (in inbox)
- Prioritized: `feature-55-description.md` (global ID assigned)
- Agent-specific: `feature-55-cc-description-log.md` (Fleet mode)

## Quick Start

### 1. Install Aigon CLI

```bash
git clone https://github.com/yourname/aigon.git
cd aigon
npm install
npm link
```

### 2. Initialize your project and install agents

```bash
cd /path/to/your/project
aigon init                         # Create docs/specs directory structure
aigon install-agent cc gg          # Install agents you want to use
```

`aigon init` creates the `docs/specs/` folder structure (features, research, feedback with Kanban lanes). `aigon install-agent` then sets up slash commands, settings, and hooks for each agent. See [Supported agents](#supported-agents) for agent codes.

### 3. Start using Aigon

There are three ways to interact with Aigon — use whichever fits the moment:

| | Slash Commands | CLI | Dashboard |
|---|---|---|---|
| **Where** | Inside an agent session | Terminal / shell | Browser UI |
| **Best for** | Writing specs, implementing features, research — anything conversational | Orchestration, setup, scripting, automation | Visual overview, monitoring Fleet runs, launching actions across repos |
| **Example** | `/aigon:feature-do 07` | `aigon feature-setup 07 cc gg` | Click "Start feature" on a kanban card |

**Slash commands**  — you stay in your agent and use Aigon commands naturally in conversation:

- Claude / Gemini: `/aigon:feature-create dark-mode`
- Codex: `/prompts:aigon-feature-create dark-mode`
- Cursor: `/aigon-feature-create dark-mode`

**CLI commands** handle orchestration that spans agents and repos — setting up Fleet worktrees, opening terminals, closing features:

```bash
aigon feature-setup 07 cc gg cx    # Create 3 worktrees for Fleet
aigon feature-open 07 --all        # Open all agents side-by-side
aigon feature-close 07 cc          # Merge the winner
```

**The Dashboard** gives you a visual pipeline across all repos. Start features, monitor agent progress, run evaluations, and merge winners — all from the browser. See [Dashboard in Action](#dashboard-in-action).

All three surfaces drive the same underlying workflow. Mix them freely: create a feature in an agent session, set up Fleet from the CLI, monitor progress on the dashboard, evaluate from another agent session.

---

## Aigon Dashboard

The dashboard is a browser-based control centre for all your Aigon repos. Monitor agent progress, launch features, run evaluations, and merge winners — all from one place.

### Dashboard in Action

A Fleet run on the BrewBoard seed project — Codex (cx) and Gemini (gg) compete to implement dark mode, then Claude Code (cc) evaluates and the winner is merged:

**1. Fleet started — Codex and Gemini implementing in parallel**

![Fleet started — Codex and Gemini implementing in parallel](docs/images/aigon-dashboard-01-fleet-start.gif)

**2. Both agents submitted — Claude Code evaluating the implementations**

![Claude Code evaluating the implementations](docs/images/aigon-dashboard-02-fleet-evaluation.gif)

**3. Evaluation complete — winner selected and merged**

![Evaluation complete — winner selected and merged](docs/images/aigon-dashboard-03-fleet-submitted.gif)

### Statistics

Track your throughput, cycle time, and agent performance across all repos.

![Aigon Dashboard Statistics](docs/images/aigon-dashboard-statistics.png)

- **Volume** — features completed per period with trend
- **Cycle Time** — average hours from setup to close
- **Agent Leaderboard** — wins, speed, and fleet win % per agent

### Getting started

```bash
aigon dashboard add                    # Register current repo
aigon dashboard start                  # Start the dashboard
aigon dashboard open                   # Open in browser (http://aigon.localhost)
```

A terminal board view is also available via `aigon board`. For dashboard commands and detailed configuration, see the [Complete Guide](GUIDE.md#dashboard-live-multi-repo-monitoring).

---

## Installation, Agents, and Updates

### Supported agents

| Code | Agent | Slash prefix | CLI command | Notes |
|------|-------|--------------|-------------|-------|
| `cc` | Claude Code | `/aigon:` | `claude` | Namespaced slash commands in `.claude/commands/aigon/` |
| `gg` | Gemini CLI | `/aigon:` | `gemini` | Commands in `.gemini/commands/aigon/` |
| `cx` | Codex | `/prompts:aigon-` | `codex` | Global prompts in `~/.codex/prompts/` |
| `cu` | Cursor | `/aigon-` | `agent` | Supports Cursor Agent and Composer command flows |

### What `install-agent` writes (and what it doesn't)

`aigon install-agent` writes **only aigon-owned files**. It never touches user-owned root files like `CLAUDE.md`.

**Files created/updated per agent:**

| Agent | Slash commands | Settings/permissions | Context delivery | Hooks |
|-------|---------------|---------------------|-----------------|-------|
| **cc** (Claude) | `.claude/commands/aigon/*.md` | `.claude/settings.json` (permissions, hooks) | `.claude/skills/aigon/SKILL.md` + SessionStart hook | `aigon check-version`, `aigon project-context` |
| **gg** (Gemini) | `.gemini/commands/aigon/*.toml` | `.gemini/settings.json` (hooks), `.gemini/policies/aigon.toml` | SessionStart hook | `aigon check-version`, `aigon project-context` |
| **cx** (Codex) | `~/.codex/prompts/aigon-*.md` (global) | `.codex/config.toml` | `.codex/prompt.md` | — |
| **cu** (Cursor) | `.cursor/commands/aigon-*.md` | `.cursor/cli.json`, `.cursor/hooks.json` | `.cursor/rules/aigon.mdc` | `aigon check-version` |

**Shared files (all agents):**

| File | Ownership | Created | Updated on re-install |
|------|-----------|---------|----------------------|
| `AGENTS.md` | User-owned | Scaffolded on first install only | Never — your file, your content |
| `docs/agents/{agent}.md` | Aigon-owned (marker blocks) | Yes | Yes (content between markers only) |
| `docs/development_workflow.md` | Aigon-owned | Yes | Yes (full overwrite) |

**What aigon never writes to:**
- `CLAUDE.md` — entirely user-owned
- Any file outside the paths listed above

### How context reaches each agent

Instead of injecting marker blocks into user-owned files, aigon delivers context through each agent's native extension mechanism:

- **Claude Code / Gemini CLI**: A `SessionStart` hook runs `aigon project-context`, which prints doc pointers to stdout. The agent ingests this as conversation context on every session start.
- **Cursor**: A native rules file at `.cursor/rules/aigon.mdc` with `alwaysApply: true` provides the same context.
- **Codex**: A native prompt file at `.codex/prompt.md` provides the same context.

### Updating

```bash
aigon update
```

Re-runs `install-agent` for all detected agents. Updates command templates, hooks, and aigon-owned doc files. Never touches `CLAUDE.md` or `AGENTS.md`.

**Auto-update**: The `aigon check-version` SessionStart hook detects version mismatches and runs `aigon update` automatically on the next agent session start.

### Configuration and Security

**Default behavior:** Aigon uses permissive "yolo mode" flags by default that auto-approve agent commands:
- **cc** (Claude): `--permission-mode acceptEdits` (auto-edits, prompts for risky Bash)
- **cu** (Cursor): `--force` (auto-approves commands)
- **gg** (Gemini): `--yolo` (auto-approves all)
- **cx** (Codex): interactive by default (`--full-auto` only in autonomous mode)

**To use stricter permissions** (e.g., for corporate environments):

```bash
aigon config init --global                              # Create global config
aigon config set --global agents.cc.implementFlag ""    # Remove auto-approval for Claude
```

Set `implementFlag` to `""` (empty string) for any agent to require manual approval prompts.

**Terminal and tmux config:**

```bash
aigon config set --global terminal tmux          # Use tmux for persistent sessions
aigon config set --global tmuxApp iterm2         # Use iTerm2 with native tmux -CC integration
```

**Project-level config** defaults to project scope:

```bash
aigon config init                       # Create project config (auto-detects profile)
aigon config set profile web            # Set project profile
aigon config get terminal               # Show value + where it comes from
aigon config show                       # Show merged effective config
aigon config models                     # Show resolved task models + source for each agent
```

`aigon config models` resolves task-level model overrides with this precedence:
`AIGON_<AGENT>_<TASK>_MODEL` env var > project config > global config (`~/.aigon/config.json`) > template default.

See the [Complete Guide](GUIDE.md#configuration) for all config commands and options.

---

## Project-Specific Agent Instructions

Add shared project rules directly in `AGENTS.md` and/or `CLAUDE.md`. These are your files — aigon scaffolds `AGENTS.md` on first install but never overwrites it afterward.

- **`AGENTS.md`**: Shared instructions read by Gemini, Codex, and Cursor (agents that support `supportsAgentsMd`)
- **`CLAUDE.md`**: Claude Code's native project instructions file — Claude reads this automatically
- **`docs/agents/{id}.md`**: Agent-specific operational notes (aigon-managed, marker blocks updated on install)

Aigon delivers its own context (doc pointers to workflow files) via SessionStart hooks and native rules files — it does not inject content into your root instruction files.

---

## Workflow Overview

Aigon organises work into three lifecycles:

| Lifecycle | Purpose | Commands |
|-----------|---------|----------|
| **Features** | Build and ship code | `feature-create` → `feature-prioritise` → `feature-setup` → `feature-do` → `feature-close` (Fleet adds `feature-eval` before close) |
| **Research** | Investigate before building | `research-create` → `research-prioritise` → `research-setup` → `research-do` → `research-synthesize` → `research-close` |
| **Feedback** | Capture and triage user input | `feedback-create` → `feedback-list` → `feedback-triage` |

Each lifecycle can run in any of four modes:

| | **Hands-on** (you guide) | **Hands-off** (agent loops autonomously) |
|---|---|---|
| **Single agent** | **Drive** — you and one agent, step by step | **Autopilot** — agent retries until tests pass |
| **Multiple agents** | **Fleet** — agents compete, you pick the winner | **Swarm** — agents compete autonomously, you evaluate results |

The examples below show each combination with realistic commands.

---

## Workflow Examples

### Drive Mode — one agent, guided by you

```text
/aigon:feature-create jwt-auth
/aigon:feature-prioritise jwt-auth          # Assigns ID (e.g., #07)
/aigon:feature-setup 07                     # Creates branch
/aigon:feature-do 07                        # Agent implements the spec
/aigon:feature-review 07                    # Optional: cross-agent code review
/aigon:feature-close 07                     # Merge to main
```

**Fast-track:** `/aigon:feature-now dark-mode` does create + setup + implement in one step.

### Fleet Mode — multiple agents compete

```text
/aigon:feature-setup 07 cc gg cx           # 3 worktrees, 3 branches
/aigon:feature-open 07 --all               # Opens all agents side-by-side
```

Each agent runs `/aigon:feature-do 07` independently. When all submit:

```text
/aigon:feature-eval 07                     # Compare implementations
aigon feature-close 07 cc                   # Merge the winner
```

### More modes

| Mode | Command | Description |
|------|---------|-------------|
| **Autopilot** | `/aigon:feature-do 07 --autonomous` | Agent retries until tests pass |
| **Swarm** | Fleet + `--autonomous --auto-submit` | Multiple agents, fully hands-off |
| **Research** | `/aigon:research-create` → `research-do` → `research-synthesize` | Investigate before building |
| **Feedback** | `/aigon:feedback-create` → `feedback-triage` | Capture and classify user input |

For detailed examples of each mode, see the [Complete Guide — Workflow Examples](GUIDE.md#detailed-feature-lifecycle).

---

## Terminal Setup (tmux + iTerm2)

Aigon supports persistent terminal sessions via **tmux**. Agent sessions survive terminal closes — detach, close your laptop, and reattach later to find the agent exactly where you left it.

### Prerequisites

```bash
brew install tmux                          # Required
brew install --cask iterm2                 # Optional but recommended
```

### Configuration

```bash
aigon config set --global terminal tmux    # Use tmux for all sessions
aigon config set --global tmuxApp iterm2   # Use iTerm2 with native tmux -CC integration
```

| `tmuxApp` value | Behaviour |
|-----------------|-----------|
| `terminal` (default) | Opens Terminal.app, runs `tmux attach` inside it |
| `iterm2` | Opens iTerm2 with `tmux -CC` — tmux windows become native iTerm2 tabs with scrollback, Cmd+F search, and trackpad scrolling |

### Session Lifecycle

```bash
aigon feature-setup 07 cc gg cx            # Creates tmux sessions: aigon-f7-cc, aigon-f7-gg, aigon-f7-cx
aigon feature-open 07 cc                  # Attaches to aigon-f7-cc (or creates if missing)
aigon feature-open 07 --all               # Opens all agents in separate windows

tmux ls                                    # List all Aigon sessions
# aigon-f7-cc: 1 windows (created ...)
# aigon-f7-gg: 1 windows (created ...)

aigon sessions-close 07                    # Kill all tmux sessions for feature 07
```

Detach from any session with `Ctrl-b d`. Reattach manually with `tmux attach -t aigon-f7-cc`.

### Supported Terminal Backends

| Backend | Config value | Agent auto-launch | Persistent sessions | Split panes |
|---------|-------------|-------------------|--------------------|-|
| **Warp** | `warp` | Yes | No | Yes (Fleet `--all`) |
| **tmux** | `tmux` | Yes | Yes (survives terminal close) | No (separate windows) |
| **VS Code** | `code` | No (manual) | No | No |
| **Cursor** | `cursor` | No (manual) | No | No |
| **Terminal.app** | `terminal` | Yes | No | No |

---

## Hooks

Hooks let you run custom scripts before and after Aigon commands.

- Define hooks in `docs/aigon-hooks.md`
- Hook names follow `pre-<command>` and `post-<command>` headings
- Pre-hook failure aborts the command
- Post-hook failure warns but does not roll back completed command

Common use cases:

- database branch setup/teardown
- service orchestration
- project-specific automation steps

Run `aigon hooks list` to inspect discovered hooks.

---

## Local Dev Proxy

Aigon's dev proxy replaces port numbers with meaningful subdomain URLs: `http://cc-119.whenswell.localhost` instead of `http://localhost:3847`.

```bash
aigon proxy install              # One-time: system daemon on port 80
aigon dev-server start           # Start dev server with proxy URL
```

No DNS configuration needed — `.localhost` resolves automatically. Without the proxy, everything falls back to `localhost:<port>`.

See the [Complete Guide](GUIDE.md#local-dev-proxy) for URL scheme, per-project configuration, and troubleshooting.

---

## Multi-Agent Evaluation (Fleet Only)

After Fleet implementations are complete, `feature-eval` generates a structured comparison so you can score implementations against spec compliance, quality, and performance. Note: `feature-eval` requires multiple implementations to compare — it is Fleet-only and will reject solo/Drive features.

```bash
aigon feature-eval 55                      # Compare implementations
aigon feature-close 55 cc                  # Merge the winner
aigon feature-close 55 cc --adopt all      # Merge + review diffs from losers
```

**Meta example:** This README was itself improved using Fleet mode — three agents competed, and the best approach was selected through evaluation. See [`docs/specs/features/evaluations/feature-06-eval.md`](docs/specs/features/evaluations/feature-06-eval.md).

To adopt valuable improvements from losing agents (extra tests, error handling, edge cases):

```bash
aigon feature-close 55 cx --adopt all        # Review diffs from all losers
aigon feature-close 55 cx --adopt gg cu      # Review diffs from specific agents
```

The `--adopt` flag prints diffs from each losing agent after merging the winner, so you can selectively apply their best contributions.

---

For the full CLI reference and agent slash command tables, see the [Complete Guide — CLI Reference](GUIDE.md#cli-reference).

---

## Comparing Aigon to Other Tools

Wondering how Aigon compares to Cursor IDE, Windsurf, or other integrated AI development tools?

See [COMPARISONS.md](COMPARISONS.md) for strategic analysis including:
- Philosophy and architecture differences
- Feature comparison tables
- Strengths and weaknesses
- Cost analysis
- When to choose which tool
- How to use Aigon + Cursor together

**Key insight:** Aigon and tools like Cursor can complement each other—use Aigon for vendor-independent workflow orchestration and include Cursor as one agent in Fleet mode.

---

📘 **For detailed workflows, hooks, project profiles, and advanced configuration, see the [Complete Guide](GUIDE.md)**
