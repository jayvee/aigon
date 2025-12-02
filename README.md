# Farline Flow

**A lightweight, Spec-Driven framework for AI-native software engineering.**

Farline Flow brings structure to multi-agent development without the bloat. It is a **100% file-based system** that uses simple folder conventions to guide AI agents through a clear **Research → Feature Specification → Code** loop, ensuring they understand the "why" and "what" before writing the "how."

Designed for simplicity and data sovereignty, Farline Flow requires **no external databases, servers, or complex tooling**. Everything lives directly in your repository. It enforces strict **"Definition of Done" guardrails**, ensuring agents document their work before merging.

Farline Flow supports single-agent development as well as parallel multi-agent "bake-offs"—where agents like Claude Code, Gemini, and Codex compete to implement specs—while keeping your workflow portable, transparent, and under your control.

---

## 📖 Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [The Specs Architecture](#the-specs-architecture)
3. [The Workflow](#the-workflow)
4. [Multi-Agent "Bake-Offs"](#multi-agent-bake-offs)
5. [Installation & Setup](#installation--setup)
6. [CLI Reference](#cli-reference)
7. [Agent Macros](#agent-macros)

---

## Core Philosophy

Traditional workflows (Jira tickets + feature branches) break down with high-speed AI agents. Agents need rigid context, explicit state, and isolated sandboxes to work effectively.

Farline Flow provides this structure via Git and the filesystem:
* **State-as-Folders:** The status of a task is defined by *where it lives* (`inbox`, `backlog`, `in-progress`), not by a separate database record.
* **Decoupled Lifecycles:** Research and Features are separate entities. Research explores *what* to build; Features define *how* to build it.
* **Traceable History:** All agent conversations and implementation attempts are preserved as Markdown files within the repository itself.

---

## The Specs Architecture

All workflow state is maintained in a strictly structured directory called **`./docs/specs`**. This folder (fully compatible with external knowledge tools like Obsidian) serves as the project's single source of truth.

The architecture separates concerns into distinct, state-driven folders:

* **Primary Domains:** `/research-topics` (The "Why") and `/features` (The "How").
* **State Folders (Kanban):** Numbered for visual ordering: `01-inbox`, `02-backlog`, `03-in-progress`, `04-in-evaluation`, `05-done`, `06-paused`.
* **Documentation:** `/logs` (stores implementation logs) and `/evaluations` (stores LLM Judge reports).
* **History:** The `logs/selected` folder contains the final, merged documentation, and `logs/alternatives` contains the logs from the losing agents.

### Naming Conventions
* **Drafts:** `feature-description.md` (Unprioritized, in `01-inbox`)
* **Prioritized:** `feature-55-description.md` (Global Sequential ID assigned on prioritization)
* **Worktrees:** `../feature-55-cc-description` (Sibling directory to your repo)

---

## The Workflow

### 1. Research Lifecycle
Used for exploring complex topics before writing code.
* **Create:** `ff research-create "API Design"` creates a templated topic in `/inbox`.
* **Prioritize:** `ff research-prioritise api-design` moves it to `/backlog` and assigns a global ID.
* **Execute:** Agents read the file from `/in-progress` and write findings to `/logs`.
* **Output:** Research results in one or more new Feature Specs in `features/inbox`.

### 2. Feature Lifecycle
Used for shipping code based on a defined spec.

1.  **Create:** `ff feature-create "Dark Mode"` creates a templated spec in `/inbox`.
2.  **Prioritize:** `ff feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Start:** `ff feature-start 108 cc`
    * Moves Spec to `/in-progress`.
    * Creates a **Git Worktree** (`../feature-108-cc-desc`).
    * **Auto-creates** a blank Analysis Log template.
4.  **Implement:** The agent switches to the worktree and writes code.
5.  **Document:** The agent *must* fill out the Analysis Log.
6.  **Eval:** `ff feature-eval` moves the feature to `/in-evaluation` for review.
7.  **Finish:** `ff feature-done 108 cc`
    * **Blocks** if the Analysis Log is empty (Enforced Guardrail).
    * Merges the branch.
    * Cleans up the worktree.
    * Archives the log to `selected`.

---

## Multi-Agent "Bake-Offs"

Run multiple agents in competition to find the optimal solution.

### How it works:
1.  **Launch:**
    ```bash
    ff feature-start 108 cc
    ff feature-start 108 gg
    ```
2.  **Isolate:** This creates two sibling folders sharing your repo history:
    * `../feature-108-cc-darkmode` (Claude)
    * `../feature-108-gg-darkmode` (Gemini)
3.  **Compete:** Each agent builds the feature independently.
4.  **Judge:** Review solutions in `/features/in-evaluation`.
5.  **Merge Winner:**
    ```bash
    ff feature-done 108 cc
    ```
    * Merges Claude's branch.
    * Moves Claude's log to `logs/selected`.
    * Moves Gemini's log to `logs/alternatives` (preserving history).
6.  **Cleanup Loser:**
    ```bash
    ff cleanup 108
    ```
    * Force-deletes the remaining Gemini worktree.

---

## Installation & Setup

### 1. Install the CLI
First, clone this repository and use `npm link` to make the `ff` command globally available.

```bash
git clone https://github.com/yourname/farline-flow.git
cd farline-flow
npm install
npm link
```

### 2. Initialize Your Project
Navigate to your project's root directory and run `ff init`. This will create the necessary `docs/specs` directory structure.

```bash
cd /path/to/your/project
ff init
```

### 3. Install Agent Configurations
To integrate Farline Flow with your AI agents, run `ff install-agent`. This command generates the required configuration files for the specified agents. You can install multiple agents at once.

```bash
# Install single agent
ff install-agent cc

# Install multiple agents at once
ff install-agent cc gg cx
```

**Supported Agents:**
| Agent | Alias | Description |
|-------|-------|-------------|
| `cc` | `claude` | Claude Code |
| `gg` | `gemini` | Gemini CLI |
| `cx` | `codex` | GitHub Copilot/Codex |

**Generated Files:**
```
your-project/
├── docs/
│   ├── development_workflow.md    # Shared workflow documentation
│   └── agents/
│       ├── claude.md              # Claude-specific instructions
│       ├── gemini.md              # Gemini-specific instructions
│       └── codex.md               # Codex-specific instructions
├── CLAUDE.md                      # Root file for Claude Code
├── GEMINI.md                      # Root file for Gemini CLI
├── CODEX.md                       # Root file for Codex
├── .claude/                       # Claude skills & slash commands
└── .gemini/                       # Gemini command files
```

**Re-installation:** Running `install-agent` again will update the Farline Flow sections while preserving any custom content you've added outside the `<!-- FARLINE_FLOW_START/END -->` markers.

**Important:** You must commit the generated configuration files to Git. This ensures that when `ff` creates a new git worktree, the agent configurations are available in that isolated environment.

---

## CLI Reference

The `ff` (Farline Flow) command automates state transitions and Git operations.

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Init** | `ff init` | Creates the `./docs/specs` directory structure in the current project. |
| **Feature Create** | `ff feature-create <name>` | Creates a new feature spec from template in `features/inbox`. |
| **Feature Prioritise** | `ff feature-prioritise <name>` | Promotes a feature draft from `inbox` to `backlog` with a new ID. |
| **Feature Start (solo)** | `ff feature-start <ID>` | Solo mode: creates a branch, work in current directory. |
| **Feature Start (multi)** | `ff feature-start <ID> <agent>` | Multi-agent mode: creates a worktree for bake-offs. |
| **Feature Evaluate** | `ff feature-eval <ID>` | Moves feature to evaluation (optional, for multi-agent review). |
| **Feature Finish (solo)** | `ff feature-done <ID>` | Merges solo branch (`feature-ID-desc`) and completes. |
| **Feature Finish (multi)** | `ff feature-done <ID> <agent>` | Merges agent's worktree branch, cleans up worktree. |
| **Research Create** | `ff research-create <name>` | Creates a new research topic from template in `research-topics/inbox`. |
| **Research Prioritise** | `ff research-prioritise <name>` | Promotes a research draft from `inbox` to `backlog` with a new ID. |
| **Research Start** | `ff research-start <ID>` | Moves a research topic from `backlog` to `in-progress`. |
| **Research Done** | `ff research-done <ID>` | Moves a research topic from `in-progress` to `done`. |
| **Cleanup** | `ff cleanup <ID>` | Force-deletes any remaining worktrees for a specific feature ID. |
| **Install Agent** | `ff install-agent <agents...>` | Generates agent configuration files. Accepts multiple agents: `cc`, `gg`, `cx`. |
| **Update** | `ff update` | Updates all Farline Flow files to latest version. Re-installs detected agents. |

---


## Agent Macros

When you run `ff install-agent cc`, it installs special slash commands for Claude Code to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| `/ff-feature-create <name>` | Runs `ff feature-create <name>`. |
| `/ff-feature-prioritise <name>` | Runs `ff feature-prioritise <name>`. |
| `/ff-feature-start <ID>` | Runs `ff feature-start <ID> cc` (multi-agent mode with worktree). |
| `/ff-feature-implement <ID>` | **Context Switcher.** Detects solo/multi-agent mode, navigates to workspace, and guides implementation. |
| `/ff-feature-eval <ID>` | Runs `ff feature-eval <ID>` (optional, for multi-agent review). |
| `/ff-feature-done <ID>` | Runs `ff feature-done <ID> cc` (for multi-agent). Use `ff feature-done <ID>` for solo mode. |
| `/ff-research-create <name>` | Runs `ff research-create <name>`. |
| `/ff-research-start <ID>` | Runs `ff research-start <ID>`. |
| `/ff-help` | Shows all available Farline Flow commands. |


---

### Contributing
Pull requests are welcome. For major changes, please open a Research Topic in `./docs/specs/research-topics/inbox` first to discuss what you would like to change.