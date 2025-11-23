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

All workflow state is maintained in a strictly structured directory called **`specs`**. This folder (fully compatible with external knowledge tools like Obsidian) serves as the project's single source of truth.

The architecture separates concerns into distinct, state-driven folders:

* **Primary Domains:** `/research-topics` (The "Why") and `/features` (The "How").
* **State Folders (Kanban):** `inbox`, `backlog`, `in-progress`, `in-evaluation`, and `done`.
* **Documentation:** `/analysis` (stores WIP logs) and `/evaluations` (stores LLM Judge reports).
* **History:** The `analysis/selected` folder contains the final, merged documentation, and `analysis/alternatives` contains the logs from the losing agents.

### Naming Conventions
* **Drafts:** `feature-XX-description.md` (Unprioritized)
* **Active:** `feature-55-description.md` (Global Sequential ID)
* **Worktrees:** `../feature-55-cc-description` (Sibling directory to your repo)

---

## The Workflow

### 1. Research Lifecycle
Used for exploring complex topics before writing code.
* **Start:** Create a topic in `/inbox`.
* **Prioritize:** `ff research-prioritise` moves it to `/backlog` and assigns a global ID.
* **Execute:** Agents read the file from `/in-progress` and write findings to `/analysis`.
* **Output:** Research results in one or more new Feature Specs in `features/inbox`.

### 2. Feature Lifecycle
Used for shipping code based on a defined spec.

1.  **Start:** `ff feature-start 108 cc`
    * Moves Spec to `/in-progress`.
    * Creates a **Git Worktree** (`../feature-108-cc-desc`).
    * **Auto-creates** a blank Analysis Log template.
2.  **Implement:** The agent switches to the worktree and writes code.
3.  **Document:** The agent *must* fill out the Analysis Log.
4.  **Eval:** `ff feature-eval` moves the feature to `/in-evaluation` for review.
5.  **Finish:** `ff feature-done-won 108 cc`
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
    ff feature-done-won 108 cc
    ```
    * Merges Claude's branch.
    * Moves Claude's log to `analysis/selected`.
    * Moves Gemini's log to `analysis/alternatives` (preserving history).
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
Navigate to your project's root directory and run `ff init`. This will create the necessary `specs` directory structure.

```bash
cd /path/to/your/project
ff init
```

### 3. Install Agent Configurations
To integrate Farline Flow with your AI agents, run `ff install-agent`. This command injects the required configuration files (skills, commands, or prompts) into your project for the specified agent.

```bash
# For Claude Code
ff install-agent cc

# For Gemini CLI
ff install-agent gg

# For GitHub Copilot/Codex
ff install-agent cx
```
**Important:** You must commit the generated configuration files (e.g., `.claude/`, `.gemini/`, `FARLINE_FLOW.md`) to Git. This ensures that when `ff` creates a new git worktree, the agent configurations are available in that isolated environment.

---

## CLI Reference

The `ff` (Farline Flow) command automates state transitions and Git operations.

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Init** | `ff init` | Creates the `specs` directory structure in the current project. |
| **Research Prioritise** | `ff research-prioritise <name>` | Promotes a research draft from `inbox` to `backlog` with a new ID. |
| **Research Start** | `ff research-start <ID>` | Moves a research topic from `backlog` to `in-progress`. |
| **Research Done** | `ff research-done <ID>` | Moves a research topic from `in-progress` to `done`. |
| **Feature Prioritise** | `ff feature-prioritise <name>` | Promotes a feature draft from `inbox` to `backlog` with a new ID. |
| **Feature Start** | `ff feature-start <ID> <agent>` | Moves spec to `in-progress`, creates a Git Worktree, and creates a log template. |
| **Feature Evaluate** | `ff feature-eval <ID>` | Moves feature from `in-progress` to `in-evaluation`. |
| **Feature Finish** | `ff feature-done-won <ID> <agent>` | Validates log, merges winning agent's branch, cleans up worktree, and archives logs. |
| **Cleanup** | `ff cleanup <ID>` | Force-deletes any remaining worktrees for a specific feature ID. |
| **Install Agent** | `ff install-agent <cc\|gg\|cx>` | Generates the agent-specific configuration files (e.g., `.claude/`, `.gemini/`). |

---


## Agent Macros

When you run `ff install-agent cc`, it installs special slash commands for Claude Code to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| **`/ff-implement <ID>`** | **Context Switcher.** A detailed prompt that tells Claude to find the correct worktree, `cd` into it, read the spec, and start coding. |
| `/ff-start <ID>` | Runs `ff feature-start <ID> cc`. |
| `/ff-eval <ID>` | Runs `ff feature-eval <ID>`. |
| `/ff-done <ID>` | Runs `ff feature-done-won <ID> cc`. |
| `/ff-prioritise <name>` | Runs `ff feature-prioritise <name>`. |
| `/ff-research-start <ID>` | Runs `ff research-start <ID>`. |


---

### Contributing
Pull requests are welcome. For major changes, please open a Research Topic in `specs/research-topics/inbox` first to discuss what you would like to change.