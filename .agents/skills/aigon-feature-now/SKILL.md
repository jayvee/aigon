---
name: aigon-feature-now
description: Fast-track feature <name> - create + setup + implement in one step
---

# aigon-feature-now

Fast-track a feature from idea to implementation in one step. Works in two modes:

- **Existing feature**: If the name matches a feature in the inbox (`01-inbox/`), runs prioritise → setup (Drive) → implement
- **New feature**: If no inbox match, creates the spec from scratch, sets up a Drive branch, and starts implementation

## Argument Resolution

If no feature name is provided:
1. Ask the user what feature they want to create
2. Use a slug-friendly name (lowercase, hyphens, no spaces)

## Step 1: Check the inbox for an existing feature

List all files in `./docs/specs/features/01-inbox/` matching `feature-*.md`.

Compare the provided name/slug against the inbox filenames (partial match is fine — e.g. "ralph" matches `feature-ralph-wiggum.md`).

- **If a match is found** → go to **Path A: Fast-track existing feature**
- **If no match** → go to **Path B: Create new feature**

If multiple inbox features match, present the matches and ask the user to pick one.

---

## Path A: Fast-track existing feature

The feature already has a spec in the inbox. Prioritise it, set up Drive mode, and implement.

### A1: Explore the codebase

Before starting, explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Read the existing spec to understand what's planned.

### A2: Prioritise

```bash
aigon feature-prioritise <inbox-name>
```

This assigns an ID and prioritises the feature to backlog. Note the assigned ID from the output.

### A3: Setup (Drive mode)

```bash
aigon feature-start <ID>
```

This records the in-progress lifecycle state, refreshes the generated view, creates the branch, and creates the implementation log.

### A4: Implement

Continue from **Step 4: Implement** below, using the assigned ID.

---

## Path B: Create new feature

No inbox match — create from scratch using the CLI.

### B1: Explore the codebase

Before running the command, explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

### B2: Run the CLI command

```bash
aigon feature-now $ARGUMENTS
```

This will:
- Create a feature spec directly in `03-in-progress/` with an assigned ID
- Create a Drive branch (`feature-NN-slug`)
- Create an implementation log
- Commit everything atomically

Note the feature ID and exact file paths from the output.

### B3: Read and write the spec

Read the exact spec path printed by the CLI (`Spec: ...`).

Do **not** guess the filename from the raw argument text; `aigon feature-now` slugifies names and may trim punctuation/spacing.

Rewrite the spec sections with content informed by your codebase exploration and the conversation context:
- **Summary**: Clear one-line description
- **Problem**: What problem this solves
- **Technical Approach**: How to implement it, based on existing patterns
- **Dependencies**: What existing code is involved
- **Acceptance Criteria**: Specific, testable criteria

Commit the spec:
```
docs: write spec for feature NN
```

### B4: Continue to implementation

Continue from **Step 4: Implement** below.

---

**Skip plan mode — implement directly.**

## Step 4: Implement

Create tasks from the acceptance criteria to give the user visibility into progress.

Implement the feature according to the spec. Commit with conventional commits (`feat:`, `fix:`, `chore:`).

## Step 5: Test

### Before stopping: prepare a manual testing checklist

Generate a **Manual Testing Checklist**: re-read the spec Acceptance Criteria and write a numbered list of concrete, human-executable steps to verify each criterion. Present the checklist in your response before stopping.

**Signal that implementation is complete:**
```bash
aigon agent-status implementation-complete
```

## Step 4.5: Implementation log (depends on your mode)

Write and commit the log **before** calling `aigon agent-status implementation-complete`. Run `aigon feature-do {{ARG1_SYNTAX}}` once from the checkout where you implement — the CLI prints your mode.

- **Fleet** (another agent worktree exists for this feature): fill in the log skeleton at `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md` targeting 200–400 words, then commit it.
- **Solo Drive worktree** (only worktree for this feature): at most **one line** in that log path if the starter file exists.
- **Solo Drive branch** (feature branch in the main repo path, not an `…-<agent>-…` worktree folder): **no log** — do not create `docs/specs/features/logs/` files. Go to **Step 5** (`aigon agent-status implementation-complete`).

Override defaults with `"logging_level": "fleet-only" | "always" | "never"` in `.aigon/config.json` (Codex inlines prompts from cwd at launch and follows the same rules).

## Step 7: STOP — Implementation complete

Tell the user:

> "Implementation complete — code is on the branch, ready for review. You can ask me to make changes, or close the feature when satisfied."

**STAY in the session.** The user may review and request changes. If they do, make the changes and commit. Do NOT run or suggest `feature-close`.

**This implementation session is complete.**
