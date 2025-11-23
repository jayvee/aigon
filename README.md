
# Farline Flow

**A lightweight, Spec-Driven framework for AI-native software engineering.**

Farline Flow brings structure to multi-agent development without the bloat. It is a **100% file-based system** that uses simple folder conventions to guide AI agents through a clear **Research → Feature Specification → Code** loop, ensuring they understand the "why" and "what" before writing the "how."

Designed for simplicity and data sovereignty, Farline Flow requires **no external databases, servers, or complex tooling**. Everything lives directly in your repository - folder and file naming conventions are used to track the state of the workflow. Farline Flow support on codeing agent as well as parallel multi-agent "bake-offs"—where agents like Claude Code, Gemini, and Codex compete to implement specs—while keeping your workflow portable, transparent, and under your control.

---

## 📖 Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [The Specs Architecture](#the-specs-architecture)
3. [The Workflow](#the-workflow)
4. [Multi-Agent "Bake-Offs"](#multi-agent-bake-offs)
5. [Installation](#installation)
6. [CLI Reference](#cli-reference)
7. [Appendix: Agent Configuration](#appendix-agent-configuration)

---

## Core Philosophy

Traditional workflows (Jira tickets + feature branches) can become complex when dealing with high-speed AI agents. Agents need rigid context, explicit state, and isolated sandboxes to work effectively.

Farline Flow provides this structure by relying on Git and the filesystem:
* **State-as-Folders:** The status of a task is defined by *where it lives* (`inbox`, `backlog`, `in-progress`), not by a separate database record.
* **Decoupled Lifecycles:** Research and Features are separate entities. Research explores *what* to build; Features define *how* to build it.
* **Traceable History:** All agent conversations and implementation attempts are preserved as Markdown files within the repository itself.

---

## The Specs Architecture

All workflow state is maintained in a strictly structured directory called **`specs`**. This folder (fully compatible with external knowledge tools like Obsidian) serves as the project's single source of truth.

```text
specs/
├── research-topics/          # The "Why" and "What"
│   ├── inbox/                # Draft ideas (XX)
│   ├── backlog/              # Prioritized topics (NN)
│   ├── in-progress/          # Active research
│   ├── done/                 # Completed findings
│   └── analysis/             # Research agent logs (traceability)
│
└── features/                 # The "How"
    ├── inbox/                # Candidate features (XX)
    ├── backlog/              # Prioritized specs (NN)
    ├── in-progress/          # Active implementation
    ├── in-evaluation/        # "Bake-Off" phase (Agent vs Agent)
    ├── done/                 # Merged & Deployed
    │
    ├── evaluations/          # LLM Judge reports
    └── analysis/             # Agent work logs & history
        ├── feature-55-cc.md  # (Active WIP logs live here)
        ├── selected/         # (Merged/Winning/Single-Agent history)
        └── alternatives/     # (Unmerged/Bake-off alternatives history)
```

### Naming Conventions

  * **Drafts:** `feature-XX-description.md` (Unprioritized)
  * **Active:** `feature-55-description.md` (Global Sequential ID)
  * **Agent Work:** `feature-55-cc-analysis.md` (Agent ID `cc` included)

-----

## The Workflow

Farline Flow guides you through two distinct lifecycles for structured development.

### 1\. Research Lifecycle

Used for exploring complex topics, evaluating libraries, or answering technical questions before implementation begins.

  * **Start:** Create a topic in `/inbox`.
  * **Prioritize:** `ff research-prioritise` moves it to `/backlog` and assigns a global ID.
  * **Execute:** Agents read the file from `/in-progress` and write their findings to `/analysis`.
  * **Output:** Research should result in one or more new Feature Specs in `features/inbox`.

### 2\. Feature Lifecycle

Used for shipping code based on a defined spec.

  * **Start:** `ff feature-start 108 cc` moves Feature 108 to `/in-progress` and creates a **Git Worktree** for Agent `cc`.
  * **Implement:** The agent works in its isolated worktree/branch.
  * **Eval:** `ff feature-eval` moves the feature to `/in-evaluation` for review.
  * **Finish:** `ff feature-done-won 108 cc` merges the winner, cleans up the worktree, and archives the agent log to `analysis/selected`.

-----

## Multi-Agent "Bake-Offs"

The **Parallel Bake-Off** allows you to run multiple agents in competition to find the optimal solution for critical features.

### How it works:

1.  **Launch:** You run `ff feature-start 108 cc`, `ff feature-start 108 gg`, and `ff feature-start 108 cx`.
2.  **Isolate:** This creates three **Git Worktrees** (parallel folders sharing one repo history) to prevent agents from interfering with each other.
      * `../feature-108-cc` (Claude Code)
      * `../feature-108-gg` (Gemini)
      * `../feature-108-cx` (Codex)
3.  **Compete:** Each agent builds the feature independently.
4.  **Judge:** An **LLM Judge** (or human) reviews the three solutions in `/features/in-evaluation`.
5.  **Merge & Archive:** You select the best implementation. The winner's log (e.g., `feature-108-cc.md`) moves to `analysis/selected`, while the others move to `analysis/alternatives`.

-----

## Installation

### 1\. Install the CLI Tool

Link the `farline-cli` to your global path.

```bash
git clone [https://github.com/yourname/farline-flow.git](https://github.com/yourname/farline-flow.git)
cd farline-flow
npm install
npm link
```

### 2\. Initialize a Project

Run the init command in your target repository to create the required `specs` structure.

```bash
ff init
```

-----

## CLI Reference

The `ff` (Farline Flow) command automates the state transitions and Git operations, ensuring the directory structure remains consistent.

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Prioritize** | `ff feature-prioritise <name>` | Promotes a draft from `XX` to the next available ID `NN` and moves to backlog. |
| **Start** | `ff feature-start <ID> <agent>` | Moves to `in-progress`. **Creates a dedicated Git Worktree** for the specified agent. |
| **Evaluate** | `ff feature-eval <ID>` | Moves to `in-evaluation`. Signals agents to stop coding and prompts review. |
| **Finish** | `ff feature-done-won <ID> <agent>` | Merges the winning agent's branch (`--no-ff`), deletes the worktree, and moves logs to `selected`. |

-----

## Appendix: Agent Configuration

To make your agents "Farline-aware," copy the following templates into your agent configuration files.

### 🤖 Claude Code (`cc`)

**File:** `.claude/skills/farline-manager/SKILL.md`

```markdown
name: farline-manager
description: Manage the Farline Flow workflow states and git worktrees.
tools:
  - name: ff_start
    description: Start a feature and create worktree
    command: ff feature-start {{feature_id}} cc
  - name: ff_done
    description: Complete a feature and merge
    command: ff feature-done-won {{feature_id}} cc
system_prompt: |
  You are a Farline Flow agent (ID: cc). 
  ALWAYS read specs from `specs/features/in-progress/`.
  ALWAYS write analysis to `specs/features/analysis/feature-NN-cc-analysis.md`.
```

### 🌟 Gemini CLI (`gg`)

**File:** `.gemini/commands/farline/start-feature.toml`

```toml
name = "feature-start"
description = "Start a feature in Farline Flow"
prompt = "I will start feature {{args}}. Command: !{ff feature-start {{args}} gg}"
```

### 💻 GitHub Copilot/Codex (`cx`)

**File:** `FARLINE_FLOW.md` (Project Root)

```markdown
# Agent Identity
Your Agent ID is: `cx`

# Rules
1. DO NOT edit files in `specs/features/backlog`.
2. ONLY edit code if the feature file is in `specs/features/in-progress`.
3. When creating files, suffix them with `-cx`.
```

```
```