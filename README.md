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

### 1. Install the CLI Tool
Link the `farline-cli` to your global path.

```bash
git clone [https://github.com/yourname/farline-flow.git](https://github.com/yourname/farline-flow.git)
cd farline-flow
npm install
npm link
```
2. Initialize a Project

Run this in the root of your target application. It creates the specs folder and the specs/README.md context file.
`ff init`

3. Install Agent Configurations

Inject the Farline "Skills" and "Commands" into your local agent settings.
# For Claude Code
`ff install-agent cc`

# For Gemini CLI
`ff install-agent gg`

# For GitHub Copilot/Codex
`ff install-agent cx`

Note: You must commit the generated config files (.claude/, .gemini/, etc.) to Git so they propagate to the isolated worktrees!

## CLI Reference

The `ff` (Farline Flow) command automates the state transitions and Git operations, ensuring the directory structure remains consistent.

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Prioritize** | `ff feature-prioritise <name>` | Promotes a draft (`XX`) to the next ID (`NN`) and moves to backlog. |
| **Start** | `ff feature-start <ID> <agent>` | Moves to `in-progress`. **Creates Git Worktree**. **Creates Log Template**. |
| **Evaluate** | `ff feature-eval <ID>` | Moves to `in-evaluation`. |
| **Finish** | `ff feature-done-won <ID> <agent>` | **Validates Log**. Merges branch (`--no-ff`). Cleans worktree. Archives logs. |
| **Cleanup** | `ff cleanup <ID>` | Scans for and deletes any remaining worktrees for a specific feature (e.g., losers). |
| **Install** | `ff install-agent <cc\|gg>` | Generates the `SKILL.md` or `.toml` files needed for the agent. |

---


## Agent Macros

When `ff install-agent cc` is run, it installs special shortcuts for Claude Code to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| **`/ff-implement <ID>`** | **Context Switcher.** Tells Claude to find the correct worktree folder (`../feature-ID-cc...`), `cd` into it, read the spec, and start coding. |
| `/ff-start <ID>` | Runs `ff feature-start <ID> cc` |
| `/ff-done <ID>` | Runs `ff feature-done-won <ID> cc` |

---

### Contributing
Pull requests are welcome. For major changes, please open a Research Topic in `specs/research-topics/inbox` first to discuss what you would like to change.