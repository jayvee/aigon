# Farline Flow

**A lightweight, Spec-Driven framework for AI-native software engineering.**

Farline Flow is a **100% file-based system** that uses simple folder and file naming conventions to guide AI agents through a clear **Research → Feature Specification → Code** loop. It requires **no external databases, servers or integration to work tracking tools**. Everything lives as text files in your repository and your interaction and the decisions of agents are saved alongside your codebase.

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

Farline Flow implements spec driven AI development, where your specs are self-contained in your codebase and the workflow is implemented by simple shell scripts or agent comands.

Farline Flow provides this structure via Git and the filesystem:
* **State-as-Folders:** The status of a task is defined by *where it lives* (`inbox`, `backlog`, `in-progress`), not by a separate database record.
* **Decoupled Lifecycles:** Research and Features are separate entities. Research explores *what* to build; Features define *how* to build it.
* **Traceable History:** All agent conversations and implementation attempts are preserved as Markdown files within the repository itself.

---

## The Specs Architecture

All workflow state is maintained in a strictly structured directory called **`./docs/specs`**. This folder (fully compatible with external knowledge tools like Obsidian) serves as the project's single source of truth.

The architecture separates concerns into distinct, state-driven folders:

* **Primary Domains:** `./docs/specs/research-topics` (The "Why") and `docs/specs/features` (The "How").
* **State Folders (Kanban):** Numbered for visual ordering: `01-inbox`, `02-backlog`, `03-in-progress`, `04-in-evaluation`, `05-done`, `06-paused`.
* **Documentation:** `./docs/specs/logs` (stores implementation logs) and `./docs/specs/evaluations` (stores LLM Judge reports).
* **History:** The `./docs/specs/logs/selected` folder contains the final, merged documentation, and `./docs/specs/logs/alternatives` contains the logs from the losing agents.

### Naming Conventions
* **Drafts:** `feature-description.md` (Unprioritized, in `01-inbox`)
* **Prioritized:** `feature-55-description.md` (Global Sequential ID assigned on prioritization)
* **Worktrees:** `../feature-55-cc-description` (Sibling directory to your repo)

---

## The Workflow

### 1. Research Lifecycle
Used for exploring complex topics before writing code. Files transition within the `./docs/specs/research-topics` folder.
* **Create:** `ff research-create "API Design"` creates a templated topic in `/01-inbox`.
* **Prioritize:** `ff research-prioritise api-design` moves it to `/02-backlog` and assigns a global ID.
*   **Execute:** Agents read the file from `/03-in-progress`, write their findings and recommendations directly into the document, and create new feature specs.
*   **Output:** The research file becomes a complete record, and its primary output is one or more new Feature Specs in `features/01-inbox`.

### 2. Feature Lifecycle
Used for shipping code based on a defined spec. Files transition within the `./docs/specs/features` folder.

1.  **Create:** `ff feature-create "Dark Mode"` creates a templated spec in `/inbox`.
2.  **Prioritize:** `ff feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Start:**
    * **Solo Mode:** `ff feature-start 108`
        * Moves Spec to `/03-in-progress`.
        * Creates a **Git Branch** (`feature-108-desc`).
        * **Auto-creates** a blank Analysis Log template.
        * Work directly in your current directory.
    * **Multi-Agent Mode:** `ff feature-start 108 cc`
        * Moves Spec to `/03-in-progress`.
        * Creates a **Git Branch** (`feature-108-cc-desc`).
        * Creates a **Git Worktree** (`../feature-108-cc-desc`).
        * **Auto-creates** a blank Analysis Log template.
4.  **Implement:** The agent reads the feature spec and codes a solution.
5.  **Document:** The agent *must* fill out the Analysis Log.
6.  **Eval (multi-agent only):** `ff feature-eval 108` moves the feature to `/in-evaluation` for review.
7.  **Finish:**
    * **Solo Mode:** `ff feature-done 108`
    * **Multi-Agent Mode:** `ff feature-done 108 cc`
    * **Blocks** if the Analysis Log is empty (Enforced Guardrail).
    * Merges the branch and archives the log.
    * (Multi-agent only) Cleans up the worktree.

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
| **Feature Start (solo)** | `ff feature-start <ID>` | Solo mode: creates branch `feature-ID-desc`, work in current directory. |
| **Feature Start (multi)** | `ff feature-start <ID> <agent>` | Multi-agent mode: creates branch + worktree `../feature-ID-agent-desc`. |
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

### Claude Code
When you run `ff install-agent cc`, it installs special slash commands for Claude Code to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| `/ff-feature-create <name>` | Runs `ff feature-create <name>`. |
| `/ff-feature-prioritise <name>` | Runs `ff feature-prioritise <name>`. |
| `/ff-feature-start <ID>` | Runs `ff feature-start <ID>` (solo mode, branch only). For multi-agent, run `ff feature-start <ID> cc` manually. |
| `/ff-feature-implement <ID>` | **Context Switcher.** Detects solo/multi-agent mode, navigates to workspace, and guides implementation. |
| `/ff-feature-eval <ID>` | Runs `ff feature-eval <ID>` (optional, for multi-agent review). |
| `/ff-feature-done <ID>` | Runs `ff feature-done <ID>` (solo mode). For multi-agent, run `ff feature-done <ID> cc` manually. |
| `/ff-research-create <name>` | Runs `ff research-create <name>`. |
| `/ff-research-prioritise <name>` | Runs `ff research-prioritise <name>`. |
| `/ff-research-start <ID>` | Runs `ff research-start <ID>`. |
| `/ff-research-done <ID>` | Runs `ff research-done <ID>`. |
| `/ff-help` | Shows all available Farline Flow commands. |

### Gemini
When you run `ff install-agent gg`, it installs special slash commands for Gemini to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| `/ff:feature-create <name>` | Runs `ff feature-create <name>`. |
| `/ff:feature-prioritise <name>` | Runs `ff feature-prioritise <name>`. |
| `/ff:feature-start <ID>` | Runs `ff feature-start <ID>` (solo mode, branch only). For multi-agent, run `ff feature-start <ID> gg` manually. |
| `/ff:feature-implement <ID>` | **Context Switcher.** Detects solo/multi-agent mode, navigates to workspace, and guides implementation. |
| `/ff:feature-eval <ID>` | Runs `ff feature-eval <ID>` (optional, for multi-agent review). |
| `/ff:feature-done <ID>` | Runs `ff feature-done <ID>` (solo mode). For multi-agent, run `ff feature-done <ID> gg` manually. |
| `/ff:research-create <name>` | Runs `ff research-create <name>`. |
| `/ff:research-prioritise <name>` | Runs `ff research-prioritise <name>`. |
| `/ff:research-start <ID>` | Runs `ff research-start <ID>`. |
| `/ff:research-done <ID>` | Runs `ff research-done <ID>`. |
| `/ff:help` | Shows all available Farline Flow commands. |

### Codex
When you run `ff install-agent cx`, it installs special slash commands for Codex to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| `/prompts:ff-feature-create <name>` | Runs `ff feature-create <name>`. |
| `/prompts:ff-feature-prioritise <name>` | Runs `ff feature-prioritise <name>`. |
| `/prompts:ff-feature-start <ID>` | Runs `ff feature-start <ID>` (solo mode, branch only). For multi-agent, run `ff feature-start <ID> cx` manually. |
| `/prompts:ff-feature-implement <ID>` | **Context Switcher.** Detects solo/multi-agent mode, navigates to workspace, and guides implementation. |
| `/prompts:ff-feature-eval <ID>` | Runs `ff feature-eval <ID>` (optional, for multi-agent review). |
| `/prompts:ff-feature-done <ID>` | Runs `ff feature-done <ID>` (solo mode). For multi-agent, run `ff feature-done <ID> cx` manually. |
| `/prompts:ff-research-create <name>` | Runs `ff research-create <name>`. |
| `/prompts:ff-research-prioritise <name>` | Runs `ff research-prioritise <name>`. |
| `/prompts:ff-research-start <ID>` | Runs `ff research-start <ID>`. |
| `/prompts:ff-research-done <ID>` | Runs `ff research-done <ID>`. |
| `/prompts:ff-help` | Shows all available Farline Flow commands. |


---
