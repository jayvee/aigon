# Aigon

**CLI-first, vendor-independent AI engineering workflows that keep your context in your repo.**

Aigon gives you a consistent spec workflow across Claude, Gemini, Codex, and Cursor without locking your team to one IDE or one model provider.

- **CLI based:** plain files + git + terminal commands
- **Vendor independent:** works across multiple agent ecosystems
- **Slash-command native:** use agent commands day to day, keep CLI as universal fallback
- **No lock-in:** your specs, logs, research, and evaluations remain in your repository

Aigon itself is built with Aigon. Browse `docs/specs/` in this repo to see real feature specs, implementation logs, research topics, and evaluations used to build and maintain the project.

![Specs folder structure showing Aigon workflow state in-repo](docs/images/aigon-specs-folder-structure.png)

---

📘 **For detailed documentation, workflows, and advanced topics, see [GUIDE.md](docs/GUIDE.md)**

---

## Table of Contents

1. [Why Aigon](#why-aigon)
2. [Core Philosophy](#core-philosophy)
3. [The Specs Architecture](#the-specs-architecture)
4. [Quick Start](#quick-start)
5. [Installation, Agents, and Updates](#installation-agents-and-updates)
6. [Project-Specific Agent Instructions](#project-specific-agent-instructions)
7. [Slash Command Prefixes](#slash-command-prefixes)
8. [Workflow Overview](#workflow-overview)
9. [Workflow Examples](#workflow-examples)
10. [Agent Slash Commands](#agent-slash-commands)
11. [CLI Reference](#cli-reference)
12. [Hooks](#hooks)
13. [Multi-Agent Evaluation](#multi-agent-evaluation)
14. [Sample Workflow Chat](#sample-workflow-chat)

---

## Why Aigon

Aigon is for teams that want AI acceleration without handing their project memory to a third-party platform.

### Context stays with your code

Everything is stored in your repo:

- feature specs (`docs/specs/features/`)
- research topics and findings (`docs/specs/research-topics/`)
- implementation logs (`docs/specs/features/logs/`)
- evaluation reports (`docs/specs/features/04-in-evaluation/`)

That history becomes reusable context for future AI sessions, code reviews, and onboarding. In contrast, tool-hosted chat history is typically siloed per vendor account and hard to reuse across tools.

### Built for real multi-agent workflows

Aigon supports:

- **solo branch mode**
- **solo worktree mode**
- **arena mode** (multiple agents implement the same feature in parallel)
- **research mode** (parallel findings + synthesis)

---

## Core Philosophy

Aigon implements spec-driven AI development using Git and the filesystem as the foundation:

- **State-as-Folders:** Task status is defined by *where it lives* (`inbox`, `backlog`, `in-progress`), not by database records
- **Decoupled Lifecycles:** Research explores *what* to build; Features define *how* to build it
- **Traceable History:** All agent conversations and implementation attempts are preserved as Markdown files in your repository

This approach keeps your workflow transparent, portable, and fully version-controlled.

---

## The Specs Architecture

All workflow state lives in `./docs/specs`, organized into:

**Primary domains:**
- `research-topics/` — Exploring what to build
- `features/` — Specific features to implement

**State folders (Kanban):**
- `01-inbox/` — New, unprioritized items
- `02-backlog/` — Prioritized, ready to start
- `03-in-progress/` — Currently being worked on
- `04-in-evaluation/` — Completed, being reviewed
- `05-done/` — Finished and merged
- `06-paused/` — Temporarily on hold

**Documentation:**
- `logs/` — Implementation logs (selected winners + alternatives)
- `evaluations/` — Arena comparison reports

**Naming conventions:**
- Drafts: `feature-description.md` (in inbox)
- Prioritized: `feature-55-description.md` (global ID assigned)
- Agent-specific: `feature-55-cc-description-log.md` (arena mode)

---

## Quick Start

### 1. Install Aigon CLI

```bash
git clone https://github.com/yourname/aigon.git
cd aigon
npm install
npm link
```

### 2. Initialize your project

```bash
cd /path/to/your/project
aigon init
```

![Terminal output of aigon init in a fresh project](docs/images/aigon-init-output.png)

### 3. Install agent integrations

```bash
# Install one agent
aigon install-agent cc

# Install multiple agents
aigon install-agent cc gg cx cu
```

![Terminal output for multi-agent install-agent run](docs/images/aigon-install-agents.png)

### 4. Use slash commands in your agent

Primary day-to-day usage is via slash commands.

- Claude / Gemini: `/aigon:feature-create dark-mode`
- Codex: `/prompts:aigon-feature-create dark-mode`
- Cursor: `/aigon-feature-create dark-mode`

![Slash command menu showing Aigon commands](docs/images/aigon-slash-commands-menu.png)

---

## Installation, Agents, and Updates

### Supported agents

| Code | Agent | Slash prefix | CLI command | Notes |
|------|-------|--------------|-------------|-------|
| `cc` | Claude Code | `/aigon:` | `claude` | Namespaced slash commands in `.claude/commands/aigon/` |
| `gg` | Gemini CLI | `/aigon:` | `gemini` | Commands in `.gemini/commands/aigon/` |
| `cx` | Codex | `/prompts:aigon-` | `codex` | Global prompts in `~/.codex/prompts/` |
| `cu` | Cursor | `/aigon-` | `agent` | Supports Cursor Agent and Composer command flows |

### Generated files

`aigon install-agent` creates/upgrades agent docs and command files, including:

- root files like `CLAUDE.md`, `GEMINI.md` (where applicable)
- `docs/agents/*.md`
- command files under `.claude/`, `.gemini/`, `.cursor/`, and `~/.codex/prompts/`
- Cursor settings file `.cursor/cli.json`

### Updating safely

Use:

```bash
aigon update
```

Aigon updates only the managed blocks wrapped with:

- `<!-- AIGON_START -->`
- `<!-- AIGON_END -->`

Custom content outside those markers is preserved. This is how you keep project-specific instructions while still receiving template updates.

![AIGON_START/AIGON_END marker example preserving custom instructions](docs/images/aigon-update-markers.png)

---

## Project-Specific Agent Instructions

Add your project-specific rules outside managed marker blocks in generated files such as `CLAUDE.md` and `GEMINI.md`.

Example pattern:

```markdown
# CLAUDE.md

Project custom instructions here (outside marker block)

<!-- AIGON_START -->
... Aigon-managed generated content ...
<!-- AIGON_END -->

More project custom instructions here (outside marker block)
```

When you run `aigon update` or `aigon install-agent ...` again, the Aigon-managed block updates and your custom sections remain.

---

## Slash Command Prefixes

Aigon command naming by agent:

- Claude / Gemini: `/aigon:<command>`
- Cursor: `/aigon-<command>`
- Codex: `/prompts:aigon-<command>`

Examples for the same action:

- Claude: `/aigon:feature-implement 42`
- Gemini: `/aigon:feature-implement 42`
- Cursor: `/aigon-feature-implement 42`
- Codex: `/prompts:aigon-feature-implement 42`

---

## Workflow Overview

### Feature lifecycle

1. Create spec: `feature-create`
2. Prioritise: `feature-prioritise`
3. Setup: `feature-setup`
4. Implement: `feature-implement`
5. Evaluate (optional but recommended): `feature-eval`
6. Finish and merge: `feature-done`
7. Cleanup losing arena branches/worktrees (arena only): `feature-cleanup`

### Research lifecycle

1. Create topic: `research-create`
2. Prioritise: `research-prioritise`
3. Setup: `research-setup`
4. Open agents (arena): `research-open`
5. Conduct: `research-conduct`
6. Synthesize (arena): `research-synthesize`
7. Complete: `research-done`

---

## Workflow Examples

### Solo development (fast-track branch mode)

Slash command first:

```text
/aigon:feature-now dark-mode
```

Use this when you want to go from idea to implementation in one session.

### Arena competition (parallel worktrees)

Setup arena:

```text
/aigon:feature-setup 55 cc gg cx
```

Open all worktrees side-by-side in Warp:

```text
/aigon:worktree-open 55 --all
```

![Warp split view with arena worktrees side-by-side](docs/images/aigon-warp-arena-split.png)
![worktree-open command output for a feature](docs/images/aigon-worktree-open.png)

### Multi-agent research (create -> conduct -> synthesize)

1. Create and prioritise:

```text
/aigon:research-create plugin-distribution
/aigon:research-prioritise plugin-distribution
```

2. Setup arena research:

```text
/aigon:research-setup 03 cc gg cx
/aigon:research-open 03
```

3. In each agent pane:

```text
/aigon:research-conduct 03
```

4. Synthesize findings:

```text
/aigon:research-synthesize 03
```

5. Finalize from CLI:

```bash
aigon research-done 03 --complete
```

### Parallel solo worktree workflow (multiple features)

Run independent features in parallel with one agent:

```bash
aigon feature-setup 100 cc
aigon feature-setup 101 cc
aigon feature-setup 102 cc
aigon worktree-open 100 101 102 --agent=cc
```

---

## Agent Slash Commands

The command set is consistent across agents. Differences are only command prefix and storage location.

### Claude (`/aigon:`)

| Slash Command | Description |
|---|---|
| `/aigon:feature-create <name>` | Create a feature spec |
| `/aigon:feature-now <name>` | Fast-track: create + setup + implement (solo branch) |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-setup <ID> [agents...]` | Setup branch/worktree/arena |
| `/aigon:feature-list` | List features by status and mode |
| `/aigon:feature-implement <ID>` | Implement in current branch/worktree |
| `/aigon:feature-eval <ID>` | Generate review/comparison template |
| `/aigon:feature-review <ID>` | Cross-agent code review with fixes |
| `/aigon:feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon:feature-cleanup <ID> [--push]` | Cleanup arena worktrees and branches |
| `/aigon:worktree-open [ID] [agent]` | Open worktree(s) with agent CLI |
| `/aigon:research-create <name>` | Create a research topic |
| `/aigon:research-prioritise <name>` | Prioritise a research topic |
| `/aigon:research-setup <ID> [agents...]` | Setup solo/arena research |
| `/aigon:research-open <ID>` | Open arena research agents side-by-side |
| `/aigon:research-conduct <ID>` | Write findings |
| `/aigon:research-synthesize <ID>` | Compare and synthesize all findings |
| `/aigon:research-done <ID>` | Complete research topic |
| `/aigon:help` | Show available Aigon commands |

### Gemini (`/aigon:`)

| Slash Command | Description |
|---|---|
| `/aigon:feature-create <name>` | Create a feature spec |
| `/aigon:feature-now <name>` | Fast-track: create + setup + implement (solo branch) |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-setup <ID> [agents...]` | Setup branch/worktree/arena |
| `/aigon:feature-list` | List features by status and mode |
| `/aigon:feature-implement <ID>` | Implement in current branch/worktree |
| `/aigon:feature-eval <ID>` | Generate review/comparison template |
| `/aigon:feature-review <ID>` | Cross-agent code review with fixes |
| `/aigon:feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon:feature-cleanup <ID> [--push]` | Cleanup arena worktrees and branches |
| `/aigon:worktree-open [ID] [agent]` | Open worktree(s) with agent CLI |
| `/aigon:research-create <name>` | Create a research topic |
| `/aigon:research-prioritise <name>` | Prioritise a research topic |
| `/aigon:research-setup <ID> [agents...]` | Setup solo/arena research |
| `/aigon:research-open <ID>` | Open arena research agents side-by-side |
| `/aigon:research-conduct <ID>` | Write findings |
| `/aigon:research-synthesize <ID>` | Compare and synthesize all findings |
| `/aigon:research-done <ID>` | Complete research topic |
| `/aigon:help` | Show available Aigon commands |

### Codex (`/prompts:aigon-`)

| Slash Command | Description |
|---|---|
| `/prompts:aigon-feature-create <name>` | Create a feature spec |
| `/prompts:aigon-feature-now <name>` | Fast-track: create + setup + implement (solo branch) |
| `/prompts:aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/prompts:aigon-feature-setup <ID> [agents...]` | Setup branch/worktree/arena |
| `/prompts:aigon-feature-list` | List features by status and mode |
| `/prompts:aigon-feature-implement <ID>` | Implement in current branch/worktree |
| `/prompts:aigon-feature-eval <ID>` | Generate review/comparison template |
| `/prompts:aigon-feature-review <ID>` | Cross-agent code review with fixes |
| `/prompts:aigon-feature-done <ID> [agent]` | Merge and complete feature |
| `/prompts:aigon-feature-cleanup <ID> [--push]` | Cleanup arena worktrees and branches |
| `/prompts:aigon-worktree-open [ID] [agent]` | Open worktree(s) with agent CLI |
| `/prompts:aigon-research-create <name>` | Create a research topic |
| `/prompts:aigon-research-prioritise <name>` | Prioritise a research topic |
| `/prompts:aigon-research-setup <ID> [agents...]` | Setup solo/arena research |
| `/prompts:aigon-research-open <ID>` | Open arena research agents side-by-side |
| `/prompts:aigon-research-conduct <ID>` | Write findings |
| `/prompts:aigon-research-synthesize <ID>` | Compare and synthesize all findings |
| `/prompts:aigon-research-done <ID>` | Complete research topic |
| `/prompts:aigon-help` | Show available Aigon commands |

### Cursor (`/aigon-`)

| Slash Command | Description |
|---|---|
| `/aigon-feature-create <name>` | Create a feature spec |
| `/aigon-feature-now <name>` | Fast-track: create + setup + implement (solo branch) |
| `/aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon-feature-setup <ID> [agents...]` | Setup branch/worktree/arena |
| `/aigon-feature-list` | List features by status and mode |
| `/aigon-feature-implement <ID>` | Implement in current branch/worktree |
| `/aigon-feature-eval <ID>` | Generate review/comparison template |
| `/aigon-feature-review <ID>` | Cross-agent code review with fixes |
| `/aigon-feature-done <ID> [agent]` | Merge and complete feature |
| `/aigon-feature-cleanup <ID> [--push]` | Cleanup arena worktrees and branches |
| `/aigon-worktree-open [ID] [agent]` | Open worktree(s) with agent CLI |
| `/aigon-research-create <name>` | Create a research topic |
| `/aigon-research-prioritise <name>` | Prioritise a research topic |
| `/aigon-research-setup <ID> [agents...]` | Setup solo/arena research |
| `/aigon-research-open <ID>` | Open arena research agents side-by-side |
| `/aigon-research-conduct <ID>` | Write findings |
| `/aigon-research-synthesize <ID>` | Compare and synthesize all findings |
| `/aigon-research-done <ID>` | Complete research topic |
| `/aigon-help` | Show available Aigon commands |

---

## CLI Reference

### Feature commands

| Command | Usage |
|---|---|
| Feature Create | `aigon feature-create <name>` |
| Feature Now | `aigon feature-now <name>` |
| Feature Prioritise | `aigon feature-prioritise <name>` |
| Feature Setup | `aigon feature-setup <ID> [agents...]` |
| Feature List | `aigon feature-list [--all\|--active\|--inbox\|--backlog\|--done]` |
| Feature Implement | `aigon feature-implement <ID>` |
| Feature Eval | `aigon feature-eval <ID>` |
| Feature Review | `aigon feature-review <ID>` |
| Feature Done | `aigon feature-done <ID> [agent]` |
| Feature Cleanup | `aigon feature-cleanup <ID> [--push]` |
| Worktree Open | `aigon worktree-open <ID> [agent] [--terminal=<type>]` |
| Worktree Open (Arena) | `aigon worktree-open <ID> --all` |
| Worktree Open (Parallel) | `aigon worktree-open <ID> <ID>... [--agent=<code>]` |

### Research commands

| Command | Usage |
|---|---|
| Research Create | `aigon research-create <name>` |
| Research Prioritise | `aigon research-prioritise <name>` |
| Research Setup | `aigon research-setup <ID> [agents...]` |
| Research Open | `aigon research-open <ID>` |
| Research Conduct | `aigon research-conduct <ID>` |
| Research Synthesize | `aigon research-synthesize <ID>` |
| Research Done | `aigon research-done <ID> [--complete]` |

### Utility commands

| Command | Usage |
|---|---|
| Init | `aigon init` |
| Install Agent | `aigon install-agent <cc\|gg\|cx\|cu> [more...]` |
| Update | `aigon update` |
| Hooks | `aigon hooks [list]` |
| Config | `aigon config <init\|show>` |
| Profile | `aigon profile [show\|set\|detect]` |

![Feature list output across states and modes](docs/images/aigon-feature-list.png)

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

## Multi-Agent Evaluation

After arena implementations are complete:

```bash
aigon feature-eval 55
```

This generates a structured comparison template so you can score implementations against spec compliance, quality, maintainability, and performance.

![Example output from feature-eval comparison](docs/images/aigon-feature-eval-output.png)

After selecting a winner:

```bash
aigon feature-done 55 cx
aigon feature-cleanup 55 --push
```

---

## Sample Workflow Chat

Here's a real example showing the Aigon workflow in action — from feature creation through to arena setup.

---

<table>
<tr><td>

> **🟦 User:**
>
> Can you create a feature called "show-current-project" — I want to show the current project at the top of the page in a new pane or banner area that is independent of the AI builder or the advanced edit mode. Right now it is not clear what the current project is. Please add information to the feature based on this prompt. Use the best possible UX approach.

</td></tr>
<tr><td>

**⬜ Agent:**

I'll create a comprehensive feature spec for showing the current project. Let me use the Aigon workflow:

```
⏺ Bash(/aigon:feature-create show-current-project)
  ⎿  ✅ Created: ./docs/specs/features/01-inbox/feature-show-current-project.md
     📝 Edit the spec, then prioritise it using: /aigon:feature-prioritise show-current-project
```

Perfect! I've created a comprehensive feature spec for "Show Current Project" at:
`docs/specs/features/01-inbox/feature-show-current-project.md`

> **Next step:** Run `/aigon:feature-prioritise show-current-project` to assign an ID and move it to the backlog.

</td></tr>
<tr><td>

> **🟦 User:**
>
> Yes please prioritise

</td></tr>
<tr><td>

**⬜ Agent:**

```
⏺ Bash(/aigon:feature-prioritise show-current-project)
  ⎿  ✅ Moved: feature-show-current-project.md -> 02-backlog/feature-50-show-current-project.md
     Running git: git add docs/specs/features/
     Running git: git commit -m "chore: prioritise feature 50 - move to backlog"
     📋 Assigned ID: 50
```

Feature prioritized as **feature-50-show-current-project** and moved to backlog.

> **Next step:** To implement now (solo): `/aigon:feature-setup 50`
> Or for an arena (multiple agents compete): `/aigon:feature-setup 50 cc cx gg`

</td></tr>
<tr><td>

> **🟦 User:**
>
> Can you setup a bakeoff for 50 with cc cx gg

</td></tr>
<tr><td>

**⬜ Agent:**

```
⏺ Bash(/aigon:feature-setup 50 cc cx gg)
  ⎿  ✅ Moved: feature-50-show-current-project.md -> 03-in-progress/feature-50-show-current-project.md
     Running git: git commit -m "chore: start feature 50 - move spec to in-progress"
     🌿 Created worktree: ../aigon-worktrees/feature-50-cc-show-current-project
     🌿 Created worktree: ../aigon-worktrees/feature-50-cx-show-current-project
     🌿 Created worktree: ../aigon-worktrees/feature-50-gg-show-current-project
```

Bakeoff setup complete for feature 50 with 3 agents 🏁

| Agent | Worktree | Branch |
|-------|----------|--------|
| cc | `../aigon-worktrees/feature-50-cc-show-current-project` | `feature-50-cc-show-current-project` |
| cx | `../aigon-worktrees/feature-50-cx-show-current-project` | `feature-50-cx-show-current-project` |
| gg | `../aigon-worktrees/feature-50-gg-show-current-project` | `feature-50-gg-show-current-project` |

> **Next step:** Open all worktrees side-by-side: `/aigon:worktree-open 50 --all`
> Each agent will independently implement the feature. When all are done, return here and run: `/aigon:feature-eval 50`

</td></tr>
</table>

---

## Screenshot Placeholders Checklist

Drop screenshots into `docs/images/` with these filenames:

- `docs/images/aigon-init-output.png`
- `docs/images/aigon-install-agents.png`
- `docs/images/aigon-feature-list.png`
- `docs/images/aigon-warp-arena-split.png`
- `docs/images/aigon-worktree-open.png`
- `docs/images/aigon-slash-commands-menu.png`
- `docs/images/aigon-feature-eval-output.png`
- `docs/images/aigon-specs-folder-structure.png`
- `docs/images/aigon-update-markers.png`

---

📘 **For detailed workflows, hooks documentation, project profiles, and advanced topics, see [GUIDE.md](docs/GUIDE.md)**
