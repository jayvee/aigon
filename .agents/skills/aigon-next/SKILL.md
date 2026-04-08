---
name: aigon-next
description: Suggest the most likely next workflow action based on current context
---

# aigon-next

Inspect the current git branch, worktree status, and Kanban stage to automatically suggest the most likely next workflow action. Eliminates the need to remember command names for the happy path.

## Step 1: Gather context

Run all three commands:

```bash
git branch --show-current
```

```bash
git status --short
```

```bash
aigon board --list --active
```

## Step 2: Parse the branch name

Extract context from the branch name using the pattern `feature-<ID>-<agent>-<description>` or `research-<ID>-<agent>-<description>`:

- **Type**: `feature` or `research`
- **ID**: numeric ID (e.g., `25`)
- **Agent**: agent code (e.g., `cc`, `gg`, `cx`, `cu`) — if absent, this is a Drive branch
- **Description**: slug description

If the branch is `main` (or `master`), skip to **Path D: Main branch**.

## Step 3: Apply the decision tree

### Path A: Feature branch with uncommitted changes

**Condition**: Branch matches `feature-<ID>-*` AND `git status --short` is non-empty

**Suggestion**:
> You have uncommitted changes on feature branch `<branch>`.
>
> **Suggested next step:**
> Commit your changes, update your feature log, then run:
> `aigon agent-status submitted`
>
> Implementation is only complete after `aigon agent-status submitted` succeeds.

---

### Path B: Feature branch with no uncommitted changes

**Condition**: Branch matches `feature-<ID>-*` AND `git status --short` is empty

**Check**: Are there commits on this branch beyond the base? (Look at board output — is the feature already submitted/in-progress?)

**Suggestion**:
> You are on feature branch `<branch>` with no uncommitted changes.
>
> **Suggested next steps:**
>
> 1. `aigon agent-status submitted` — if your implementation and log updates are complete
> 2. `$aigon-feature-do <ID>` — if you haven't started implementing yet

---

### Path C: Research branch

**Condition**: Branch matches `research-<ID>-*`

**Check**: Does `aigon board --list --active` show findings already written for this research ID?

**If no findings yet**:
> You are on research branch `<branch>`.
>
> **Suggested next step:**
> `$aigon-research-do <ID>`
>
> This will guide you through writing your research findings.

**If findings exist**:
> You are on research branch `<branch>` with findings already written.
>
> **Suggested next steps:**
>
> 1. `$aigon-research-close <ID>` — if research is complete
> 2. `$aigon-research-do <ID>` — to continue or update findings

---

### Path D: Main branch

**Condition**: Branch is `main` or `master`

Check `aigon board --list --active` output for in-progress items.

#### D1: In-progress features found

Count the worktrees for each in-progress feature (from board output — look for `Fleet (cc, gg...)` vs `Drive`).

**Fleet mode** (2+ agents): Suggest eval
> Feature `#<ID> <name>` is in progress (Fleet mode).
>
> **Suggested next step:**
> `$aigon-feature-eval <ID>`
>
> This will compare all agent implementations and select the best one.

**Drive mode** (1 agent): Suggest done
> Feature `#<ID> <name>` is in progress (Drive mode).
>
> **Suggested next step:**
> `$aigon-feature-close <ID>`
>
> This will merge your implementation.

#### D2: In-progress research found

> Research `#<ID> <name>` is in progress.
>
> **Suggested next step:**
> `$aigon-research-close <ID>`
>
> Or to continue conducting: `$aigon-research-do <ID>`

#### D3: Nothing active — backlog or inbox items available

Show the board summary and suggest starting something new:

> Nothing is currently in progress.
>
> **Suggested next steps:**
>
> 1. `$aigon-feature-now <name>` — fast-track a new or inbox feature
> 2. `$aigon-board` — view the full Kanban board to pick what to work on next

---

### Path E: Ambiguous or unrecognised context

**Condition**: Branch name doesn't match any known pattern, or context is unclear

Fall back to showing the board and suggesting the user pick:
> Context is ambiguous (branch: `<branch>`).
>
> **Showing board instead:**

Run `aigon board` and display the output. Then suggest:
> Run `$aigon-board` for details, or `$aigon-feature-now <name>` to start something new.

---

## Step 4: Present the suggestion

- Display the suggestion(s) clearly as a ready-to-copy Aigon agent command
- If there are multiple plausible actions, show a short numbered list (max 3 options)
- Always include a one-line explanation of what the command does
- Do NOT auto-execute the suggested command — always let the user confirm
