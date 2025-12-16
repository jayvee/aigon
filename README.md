# Aigon

**A lightweight, Spec-Driven framework for AI-native software engineering.**

Aigon is a **100% file-based system** that uses simple folder and file naming conventions to guide AI agents through a clear **Research → Feature Specification → Code** loop. It requires **no external databases, servers or integration to work tracking tools**. Everything lives as text files in your repository and your interaction and the decisions of agents are saved alongside your codebase.

Aigon supports single-agent development as well as parallel multi-agent arenas—where agents like Claude Code, Gemini, and Codex compete to implement specs—while keeping your workflow portable, transparent, and under your control.

Aigon derives its name from the fusion of "AI" and the ancient Greek concept of Agon (ἀγών), which signifies a **contest**, **struggle**, or gathering to prove one's merit. This reflects the library's core philosophy: a structured arena where multiple AI models—such as Claude, Gemini, and Codex—compete to interpret specifications and produce the highest quality code. Just as an agon drove ancient competitors to strive for excellence, Aigon drives your agent workforce to outperform one another in an arena, ensuring your final codebase is forged through rigorous comparison and selection rather than a single assumption.


---

## 📖 Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [The Specs Architecture](#the-specs-architecture)
3. [The Workflow](#the-workflow)
4. [Installation & Setup](#installation--setup)
5. [CLI Reference](#cli-reference)
6. [Hooks](#hooks)
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
* **Prioritised:** `feature-55-description.md` (Global Sequential ID assigned on prioritization)
* **Multi-Mode:** `../feature-55-cc-description` (Has a specific agent 2 letter code to indicate agent specific content)

---

## The Workflow

### 1. Research Lifecycle
Used for exploring complex topics before writing code. Files transition within the `./docs/specs/research-topics` folder.
* **Create:** `aigon research-create "API Design"` creates a templated topic in `/01-inbox`.
* **Prioritise:** `aigon research-prioritise api-design` moves it to `/02-backlog` and assigns a global ID.
*   **Execute:** Agents read the file from `/03-in-progress`, write their findings and recommendations directly into the document, and create new feature specs.
*   **Output:** The research file becomes a complete record, and its primary output is one or more new Feature Specs in `features/01-inbox`.

### 2. Feature Lifecycle
Used for shipping code based on a defined spec. Files transition within the `./docs/specs/features` folder.

#### 2.1 Solo Mode (Single Agent)

1.  **Create:** `aigon feature-create "Dark Mode"` creates a templated spec in `/inbox`.
2.  **Prioritise:** `aigon feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Setup:** `aigon feature-setup 108` (or `/aigon-feature-setup 108` in agent)
    * Moves Spec to `/03-in-progress`.
    * Creates a **Git Branch** (`feature-108-dark-mode`).
    * **Auto-creates** a blank Implementation Log template.
4.  **Implement:** Run `/aigon-feature-implement 108` in the agent
    * Agent reads the feature spec and codes a solution.
    * Agent *must* fill out the Implementation Log.
5.  **Evaluate (Optional):** `aigon feature-eval 108`
    * Creates code review checklist for the implementation.
6.  **Finish:** `aigon feature-done 108`
    * Merges the branch and archives the log.

#### 2.2 Arena Mode (Multi-Agent Competition)

Run multiple agents in competition to find the optimal solution.

1.  **Create:** `aigon feature-create "Dark Mode"` creates a templated spec in `/inbox`.
2.  **Prioritise:** `aigon feature-prioritise dark-mode` assigns an ID and moves to `/backlog`.
3.  **Setup Arena:** `aigon feature-setup 108 cc gg cx` (or `/aigon-feature-setup 108 cc gg cx`)
    * Moves Spec to `/03-in-progress`.
    * Creates agent-specific **Git Branches** (`feature-108-cc-dark-mode`, `feature-108-gg-dark-mode`, `feature-108-cx-dark-mode`).
    * Creates **Git Worktrees** in sibling folders:
        * `../feature-108-cc-dark-mode` (Claude)
        * `../feature-108-gg-dark-mode` (Gemini)
        * `../feature-108-cx-dark-mode` (Codex)
    * **Auto-creates** blank Implementation Log templates in each worktree.
    * **STOPS** - does not implement (user must open each worktree separately).
4.  **Implement:** Open each worktree in a separate editor session and run `/aigon-feature-implement 108`.
    * Each agent builds the feature independently in their isolated worktree.
    * Each agent *must* fill out their Implementation Log.
5.  **Evaluate:** Back in the main folder, switch to an eval model (eg sonnet) and run `aigon feature-eval 108`
    * Moves the feature to `/in-evaluation`.
    * Creates comparison template with all implementations.
6.  **Judge:** Review and compare solutions, fill in the evaluation.
7.  **Merge Winner:**
    ```bash
    aigon feature-done 108 cc
    ```
    * Merges winner's branch.
    * Moves winning agent's log to `logs/selected`.
    * Moves losing agent's logs to `logs/alternatives` (preserving history).
    * Cleans up winner's worktree.
8.  **Cleanup Losers:**
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
├── .claude/                       # Claude skills & slash commands
├── .gemini/                       # Gemini command files
└── .codex/                        # Codex prompts & config
    ├── prompt.md                  # Project-level Codex instructions
    └── config.toml                # Codex configuration
```

**Note:** Codex also installs global prompts in `~/.codex/prompts/` (shared across all projects).

**Re-installation:** Running `install-agent` again will update the Aigon sections while preserving any custom content you've added outside the `<!-- AIGON_START/END -->` markers.

**Important:** You must commit the generated configuration files to Git. This ensures that when `aigon` creates a new git worktree, the agent configurations are available in that isolated environment.

---

## CLI Reference

The `aigon` command automates state transitions and Git operations. The workflow uses a unified set of commands that work in both solo and arena modes.

### Feature Commands
| Command | Usage | Description |
| :--- | :--- | :--- |
| **Feature Create** | `aigon feature-create <name>` | Create a new feature spec in inbox |
| **Feature Prioritise** | `aigon feature-prioritise <name>` | Assign ID and move to backlog |
| **Feature Setup** | `aigon feature-setup <ID> [agents...]` | Setup for implementation. Solo: creates branch. Arena: creates worktrees for multiple agents |
| **Feature Implement** | `aigon feature-implement <ID>` | Auto-detects mode. Implements feature in current branch/worktree |
| **Feature Evaluate** | `aigon feature-eval <ID>` | Move to evaluation. Solo: code review checklist. Arena: comparison template |
| **Feature Done** | `aigon feature-done <ID> [agent]` | Merge and complete. Solo: merge branch. Arena: merge winner's branch |
| **Feature Cleanup** | `aigon feature-cleanup <ID> [--push]` | Clean up arena mode worktrees and branches |

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
| **Hooks List** | `aigon hooks [list]` | List all defined hooks from `docs/aigon-hooks.md`. |

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


## Agent Macros

### Claude Code
When you run `aigon install-agent cc`, it installs special slash commands for Claude Code to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| `/aigon-feature-create <name>` | Create a new feature spec |
| `/aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon-feature-setup <ID> [agents...]` | Setup for solo (no agents) or arena (with agents) |
| `/aigon-feature-implement <ID>` | Implement feature in current branch/worktree |
| `/aigon-feature-eval <ID>` | Create evaluation template (code review or comparison) |
| `/aigon-feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon-feature-cleanup <ID>` | Clean up arena worktrees and branches |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/aigon-research-create <name>` | Runs `aigon research-create <name>`. |
| `/aigon-research-start <ID>` | Runs `aigon research-start <ID>`. |
| `/aigon-help` | Shows all available Aigon commands. |

### Gemini
When you run `aigon install-agent gg`, it installs special slash commands for Gemini to make the workflow seamless.

| Slash Command | Description |
| :--- | :--- |
| `/aigon:feature-create <name>` | Create a new feature spec |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-setup <ID> [agents...]` | Setup for solo (no agents) or arena (with agents) |
| `/aigon:feature-implement <ID>` | Implement feature in current branch/worktree |
| `/aigon:feature-eval <ID>` | Create evaluation template (code review or comparison) |
| `/aigon:feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon:feature-cleanup <ID>` | Clean up arena worktrees and branches |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/aigon:research-create <name>` | Runs `aigon research-create <name>`. |
| `/aigon:research-start <ID>` | Runs `aigon research-start <ID>`. |
| `/aigon:help` | Shows all available Aigon commands. |

### Codex
When you run `aigon install-agent cx`, it installs slash commands to your **global** `~/.codex/prompts/` folder.

**Note:** Codex only supports global prompts (not project-level). This means the same Aigon commands are available across all your projects.

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-feature-create <name>` | Create a new feature spec |
| `/prompts:aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/prompts:aigon-feature-setup <ID> [agents...]` | Setup for solo (no agents) or arena (with agents) |
| `/prompts:aigon-feature-implement <ID>` | Implement feature in current branch/worktree |
| `/prompts:aigon-feature-eval <ID>` | Create evaluation template (code review or comparison) |
| `/prompts:aigon-feature-done <ID> [agent]` | Merge and complete feature |
| `/prompts:aigon-feature-cleanup <ID>` | Clean up arena worktrees and branches |

#### Research

| Slash Command | Description |
| :--- | :--- |
| `/prompts:aigon-research-create <name>` | Create a new research topic |
| `/prompts:aigon-research-start <ID>` | Start a research topic |
| `/prompts:aigon-help` | Shows all available Aigon commands |

---

## Multi-Agent Evaluation

When running multi-agent arenas, use `aigon feature-eval <ID>` to generate an evaluation template and compare implementations. For unbiased evaluation, **use a different model as the evaluator** than the ones that wrote the code.

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

#### cx (Codex)
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
aigon feature-cleanup 10 --push

# Or just delete losing branches locally
aigon feature-cleanup 10
```

---
