# Aigon

**A lightweight, Spec-Driven framework for AI-native software engineering.**

Aigon is a **100% file-based system** that uses simple folder and file naming conventions to guide AI agents through a clear **Research → Feature Specification → Code** loop. It requires **no external databases, servers or integration to work tracking tools**. Everything lives as text files in your repository and your interaction and the decisions of agents are saved alongside your codebase.

Aigon supports single-agent development as well as parallel multi-agent "bake-offs"—where agents like Claude Code, Gemini, and Codex compete to implement specs—while keeping your workflow portable, transparent, and under your control.

Aigon derives its name from the fusion of "AI" and the ancient Greek concept of Agon (ἀγών), which signifies a **contest**, **struggle**, or gathering to prove one's merit. This reflects the library's core philosophy: a structured arena where multiple AI models—such as Claude, Gemini, and Codex—compete to interpret specifications and produce the highest quality code. Just as an agon drove ancient competitors to strive for excellence, Aigon drives your agent workforce to outperform one another in a "bake-off," ensuring your final codebase is forged through rigorous comparison and selection rather than a single assumption.


---

## 📖 Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [The Specs Architecture](#the-specs-architecture)
3. [The Workflow](#the-workflow)
4. [Multi-Agent "Bake-Offs"](#multi-agent-bake-offs)
5. [Installation & Setup](#installation--setup)
6. [CLI Reference](#cli-reference)
7. [Agent Macros](#agent-macros)
8. [Multi-Agent Evaluation](#multi-agent-evaluation)

---

## Core Philosophy

Aigon implements spec driven AI development, where your specs are self-contained in your codebase and the workflow is implemented by simple shell scripts or agent comands.

Aigon provides this structure via Git and the filesystem:
* **State-as-Folders:** The status of a task is defined by *where it lives* (`inbox`, `backlog`, `in-progress`), not by a separate database record.
* **Decoupled Lifecycles:** Research and Features are separate entities. Research explores *what* to build; Features define *how* to build it.
* **Traceable History:** All agent conversations and implementation attempts are preserved as Markdown files within the repository itself.

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
* **Prioritized:** `feature-55-description.md` (Global Sequential ID assigned on prioritization)
* **Multi-Mode:** `../feature-55-cc-description` (Has a specific agent 2 letter code to indicate agent specific content)

---

## The Workflow

### 1. Research Lifecycle
Used for exploring complex topics before writing code. Files transition within the `./docs/specs/research-topics` folder.
* **Create:** `aigon research-create "API Design"` creates a templated topic in `/01-inbox`.
* **Prioritize:** `aigon research-prioritise api-design` moves it to `/02-backlog` and assigns a global ID.
*   **Execute:** Agents read the file from `/03-in-progress`, write their findings and recommendations directly into the document, and create new feature specs.
*   **Output:** The research file becomes a complete record, and its primary output is one or more new Feature Specs in `features/01-inbox`.

### 2. Feature Lifecycle
Used for shipping code based on a defined spec. Files transition within the `./docs/specs/features` folder.

#### 2.1 Single Agent Feature Lifecycle

1.  **Create:** `aigon feature-create "Dark Mode"` creates a templated spec in `/inbox`.
2.  **Prioritize:** `aigon feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Implement:** Run `/aigon-feature-implement 108` (or `aigon feature-implement 108` via CLI)
    * Moves Spec to `/03-in-progress`.
    * Creates a **Git Branch** (`feature-108-desc`).
    * **Auto-creates** a blank Analysis Log template.
    * Agent reads the feature spec and codes a solution.
    * Agent *must* fill out the Analysis Log.
4.  **Finish:** `aigon feature-done 108`
    * **Blocks** if the Analysis Log is empty (Enforced Guardrail).
    * Merges the branch and archives the log.

#### 2.2 Multi-Agent Bake-Off Feature Lifecycle

Run multiple agents in competition to find the optimal solution.

1.  **Create:** `aigon feature-create "Dark Mode"` creates a templated spec in `/inbox`.
2.  **Prioritize:** `aigon feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Setup Bakeoff:** Run `/aigon-bakeoff-setup 108 cc gg cx` (or via CLI: `aigon bakeoff-setup 108 cc gg cx`)
    * Moves Spec to `/03-in-progress`.
    * Creates agent-specific **Git Branches** (`feature-108-cc-desc`, `feature-108-gg-desc`, `feature-108-cx-desc`).
    * Creates **Git Worktrees** in sibling folders:
        * `../feature-108-cc-darkmode` (Claude)
        * `../feature-108-gg-darkmode` (Gemini)
        * `../feature-108-cx-darkmode` (Codex)
    * **Auto-creates** blank Analysis Log templates for each agent.
    * **STOPS** - does not implement (user must open each worktree separately).
4.  **Implement:** Open each worktree in a separate editor session and run `/aigon-bakeoff-implement 108`.
    * Each agent builds the feature independently in their isolated worktree.
    * Each agent *must* fill out their Analysis Log.
5.  **Evaluate:** Back in the main working folder - `aigon feature-eval 108` moves the feature to `/in-evaluation` for review.
6.  **Judge:** Review and compare solutions in `/features/in-evaluation`.
7.  **Merge Winner:**
    ```bash
    aigon feature-done 108 cc
    ```
    * **Blocks** if the Analysis Log is empty (Enforced Guardrail).
    * Merges winner's branch.
    * Moves winning agent's log to `logs/selected`.
    * Moves losing agent's logs to `logs/alternatives` (preserving history).
    * Cleans up winner's worktree.
8.  **Cleanup Losers:**
    ```bash
    aigon cleanup 108
    ```

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

### 3. Install Agent Configurations
To integrate Aigon with your AI agents, run `aigon install-agent`. This command generates the required configuration files for the specified agents. You can install multiple agents at once.

```bash
# Install single agent
aigon install-agent cc

# Install multiple agents at once
aigon install-agent cc gg cx
```

**Supported Agents:**
| Agent | Alias | Description |
|-------|-------|-------------|
| `cc` | `claude` | Claude Code |
| `gg` | `gemini` | Gemini CLI |
| `cx` | `codex` | Codex |

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

**Re-installation:** Running `install-agent` again will update the Aigon sections while preserving any custom content you've added outside the `<!-- AIGON_START/END -->` markers.

**Important:** You must commit the generated configuration files to Git. This ensures that when `aigon` creates a new git worktree, the agent configurations are available in that isolated environment.

---

## CLI Reference

The `aigon` (Aigon) command automates state transitions and Git operations.

### Solo Mode (single agent)
| Command | Usage | Description |
| :--- | :--- | :--- |
| **Feature Create** | `aigon feature-create <name>` | Create a new feature spec |
| **Feature Prioritise** |  `aigon feature-prioritise <name>` | Prioritize a feature draft |
| **Feature Implement** |  `aigon feature-implement <ID>` | Creates branch `feature-ID-desc`, moves spec to in-progress and implements solution |
| **Feature Evaluate** |  `aigon feature-eval <ID>` | Evaluate feature implementations in a bake-off, propose winner |
| **Feature Finish** |  `aigon feature-done <ID>` | Complete and merge feature |

### Multi-Agent Mode
| Command | Usage | Description |
| :--- | :--- | :--- |
| **Bakeoff Setup** | `aigon bakeoff-setup <ID> <agents>` | Create worktrees for multiple agents to implement feature  |
| **Bakeoff Implement** | `aigon bakeoff-implement <ID>` | Implement feature (branch, code) in current worktree |
| **Bakeoff Cleanup** | `aigon bakeoff-cleanup <ID> --push` | Clean up losing worktrees and branches |

### Research

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Research Create** | `aigon research-create <name>` | Creates a new research topic from template in `research-topics/inbox`. |
| **Research Prioritise** | `aigon research-prioritise <name>` | Promotes a research draft from `inbox` to `backlog` with a new ID. |
| **Research Start** | `aigon research-start <ID>` | Moves a research topic from `backlog` to `in-progress`. |
| **Research Done** | `aigon research-done <ID>` | Moves a research topic from `in-progress` to `done`. |

### Utilities

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Init** | `aigon init` | Creates the `./docs/specs` directory structure in the current project. |
| **Install Agent** | `aigon install-agent <agents...>` | Generates agent configuration files. Accepts multiple agents: `cc`, `gg`, `cx`. |
| **Update** | `aigon update` | Updates all Aigon files to latest version. Re-installs detected agents. |

---


## Agent Macros

### Claude Code
When you run `aigon install-agent cc`, it installs special slash commands for Claude Code to make the workflow seamless.

#### Solo Mode

| Slash Command | Description |
| :--- | :--- |
| `/aigon-feature-create <name>` | Runs `aigon feature-create <name>`. |
| `/aigon-feature-prioritise <name>` | Runs `aigon feature-prioritise <name>`. |
| `/aigon-feature-implement <ID>` | **Full workflow.** Creates branch, implements feature, guides to completion. |
| `/aigon-feature-eval <ID>` | Runs `aigon feature-eval <ID>` (optional). |
| `/aigon-feature-done <ID>` | Runs `aigon feature-done <ID>`. |

#### Bakeoff Mode

| Slash Command | Description |
| :--- | :--- |
| `/aigon-bakeoff-setup <ID> <agents...>` | Creates worktrees for multiple agents. **Stops after setup.** |
| `/aigon-bakeoff-implement <ID>` | Implements in current worktree. Run in each agent's worktree. |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/aigon-research-create <name>` | Runs `aigon research-create <name>`. |
| `/aigon-research-start <ID>` | Runs `aigon research-start <ID>`. |
| `/aigon-help` | Shows all available Aigon commands. |

### Gemini
When you run `aigon install-agent gg`, it installs special slash commands for Gemini to make the workflow seamless.

#### Solo Mode

| Slash Command | Description |
| :--- | :--- |
| `/aigon:feature-create <name>` | Runs `aigon feature-create <name>`. |
| `/aigon:feature-prioritise <name>` | Runs `aigon feature-prioritise <name>`. |
| `/aigon:feature-implement <ID>` | **Full workflow.** Creates branch, implements feature, guides to completion. |
| `/aigon:feature-eval <ID>` | Runs `aigon feature-eval <ID>` (optional). |
| `/aigon:feature-done <ID>` | Runs `aigon feature-done <ID>`. |

#### Bakeoff Mode

| Slash Command | Description |
| :--- | :--- |
| `/aigon:bakeoff-setup <ID> <agents...>` | Creates worktrees for multiple agents. **Stops after setup.** |
| `/aigon:bakeoff-implement <ID>` | Implements in current worktree. Run in each agent's worktree. |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/aigon:research-create <name>` | Runs `aigon research-create <name>`. |
| `/aigon:research-start <ID>` | Runs `aigon research-start <ID>`. |
| `/aigon:help` | Shows all available Aigon commands. |

### Codex
When you run `aigon install-agent cx`, it installs slash commands to your **global** `~/.codex/prompts/` folder.

**Note:** Codex only supports global prompts (not project-level). This means the same Aigon commands are available across all your projects.

#### Solo Mode

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-feature-create <name>` | Create a new feature spec |
| `/prompts:aigon-feature-prioritise <name>` | Prioritize a feature draft |
| `/prompts:aigon-feature-implement <ID>` | **Full workflow.** Creates branch, implements feature, guides to completion. |
| `/prompts:aigon-feature-eval <ID>` | Submit feature for evaluation (optional) |
| `/prompts:aigon-feature-done <ID>` | Complete and merge feature |

#### Bakeoff Mode

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-bakeoff-setup <ID> <agents...>` | Creates worktrees for multiple agents. **Stops after setup.** |
| `/prompts:aigon-bakeoff-implement <ID>` | Implements in current worktree. Run in each agent's worktree. |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-research-create <name>` | Create a new research topic |
| `/prompts:aigon-research-start <ID>` | Start a research topic |
| `/prompts:aigon-help` | Shows all available Aigon commands |

---

## Multi-Agent Evaluation

When running multi-agent bake-offs, use `aigon feature-eval <ID>` to generate an evaluation template and compare implementations. For unbiased evaluation, **use a different model as the evaluator** than the ones that wrote the code.

### Evaluator Model Recommendation

If using Claude as the evaluator, start it with a different model:

```bash
# If implementations were written by Opus, evaluate with Sonnet
claude --model sonnet

# Then run the evaluation command
/aigon-feature-eval 10
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
- ✅ **Proper normalization**: Implements punctuation removal (`/[^\w\s]/g`) and case-insensitive search
- ✅ **Smart data mapping**: Created `SWELL_DIRECTION_MAP` to handle mismatch between UI abbreviations and data model full names
- ✅ **Type safety**: Strong TypeScript typing with proper type narrowing
- ✅ **Custom debounce hook**: Clean `useDebounce` implementation
- ✅ **Performance**: Uses `useMemo` for filtered results
- ✅ **Good UI**: Labels on filters, responsive design
- ✅ **Comprehensive documentation**: Detailed implementation log

**Weaknesses:**
- ⚠️ **Non-breaking but complex**: Mapping layer adds some complexity (though it preserves data integrity)
- ⚠️ **Separate normalize calls**: Calls `normalizeSearchText()` twice per location (once for name, once for description)

#### cx (Claude via Cursor)
**Strengths:**
- ✅ **Perfect spec compliance**: All acceptance criteria met flawlessly
- ✅ **Excellent normalization**: Robust `normalizeText()` function handles punctuation, underscores, and extra whitespace
- ✅ **Optimal performance**: Uses `useMemo` for both sorting and filtering with proper dependency arrays
- ✅ **Superior code organization**: Clean, readable, well-structured
- ✅ **Enhanced UI/UX**: Professional design with card-based filter section, pills for attributes, improved layout
- ✅ **Accessibility**: Proper labels with semantic HTML, clear visual hierarchy
- ✅ **Explicit trim**: `setDebouncedSearch(searchTerm.trim())` - exactly as spec requires
- ✅ **Modified data model cleanly**: Changed to abbreviations to match spec (same as gg but implemented better)
- ✅ **No code waste**: Every line serves a purpose

**Weaknesses:**
- (None identified - this is a production-ready implementation)

#### gg (Gemini)
**Strengths:**
- ✅ **Functional implementation**: Core search and filter functionality works
- ✅ **Debounce implemented**: Correct 300ms debounce delay
- ✅ **Modified data model**: Changed swellDirection to use abbreviations directly

**Weaknesses:**
- ❌ **Spec violation - punctuation handling**: Does NOT remove punctuation - "pipeline!" would NOT match "Pipeline"
- ❌ **Spec violation - whitespace trimming**: Missing explicit trim on debounce tick
- ❌ **Poor normalization**: Only uses `.toLowerCase()`, doesn't handle punctuation
- ⚠️ **Less optimal performance**: Uses `useEffect` + `useState` instead of `useMemo` for filtering
- ⚠️ **Code inefficiency**: Has unused `sortedLocations` variable on line 50
- ⚠️ **Poor UX**: No labels on filter dropdowns, less accessible
- ⚠️ **Fragile code**: Uses `.toLowerCase()` for swell comparison which could break with data changes
```

### After Evaluation

Once you've chosen a winner, merge their implementation:

```bash
# Merge the winning implementation
aigon feature-done 10 cx

# Push losing branches to origin for safekeeping (optional)
aigon cleanup 10 --push

# Or just delete losing branches locally
aigon cleanup 10
```

---
