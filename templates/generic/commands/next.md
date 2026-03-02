<!-- description: Suggest the most likely next workflow action based on current context -->
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
- **Agent**: agent code (e.g., `cc`, `gg`, `cx`, `cu`) — if absent, this is a solo branch
- **Description**: slug description

If the branch is `main` (or `master`), skip to **Path D: Main branch**.

## Step 3: Apply the decision tree

### Path A: Feature branch with uncommitted changes

**Condition**: Branch matches `feature-<ID>-*` AND `git status --short` is non-empty

**Suggestion**:
> You have uncommitted changes on feature branch `<branch>`.
>
> **Suggested next step:**
> `{{CMD_PREFIX}}feature-submit`
>
> This will commit your changes, write the implementation log, and signal readiness for review.

---

### Path B: Feature branch with no uncommitted changes

**Condition**: Branch matches `feature-<ID>-*` AND `git status --short` is empty

**Check**: Are there commits on this branch beyond the base? (Look at board output — is the feature already submitted/in-progress?)

**Suggestion**:
> You are on feature branch `<branch>` with no uncommitted changes.
>
> **Suggested next steps:**
>
> 1. `{{CMD_PREFIX}}feature-submit` — if you have committed code ready for review
> 2. `{{CMD_PREFIX}}feature-implement <ID>` — if you haven't started implementing yet

---

### Path C: Research branch

**Condition**: Branch matches `research-<ID>-*`

**Check**: Does `aigon board --list --active` show findings already written for this research ID?

**If no findings yet**:
> You are on research branch `<branch>`.
>
> **Suggested next step:**
> `{{CMD_PREFIX}}research-conduct <ID>`
>
> This will guide you through writing your research findings.

**If findings exist**:
> You are on research branch `<branch>` with findings already written.
>
> **Suggested next steps:**
>
> 1. `{{CMD_PREFIX}}research-done <ID>` — if research is complete
> 2. `{{CMD_PREFIX}}research-conduct <ID>` — to continue or update findings

---

### Path D: Main branch

**Condition**: Branch is `main` or `master`

Check `aigon board --list --active` output for in-progress items.

#### D1: In-progress features found

Count the worktrees for each in-progress feature (from board output — look for `arena (cc, gg...)` vs `solo`).

**Arena mode** (2+ agents): Suggest eval
> Feature `#<ID> <name>` is in progress (arena mode).
>
> **Suggested next step:**
> `{{CMD_PREFIX}}feature-eval <ID>`
>
> This will compare all agent implementations and select the best one.

**Solo mode** (1 agent): Suggest done
> Feature `#<ID> <name>` is in progress (solo mode).
>
> **Suggested next step:**
> `{{CMD_PREFIX}}feature-done <ID>`
>
> This will merge your implementation.

#### D2: In-progress research found

> Research `#<ID> <name>` is in progress.
>
> **Suggested next step:**
> `{{CMD_PREFIX}}research-done <ID>`
>
> Or to continue conducting: `{{CMD_PREFIX}}research-conduct <ID>`

#### D3: Nothing active — backlog or inbox items available

Show the board summary and suggest starting something new:

> Nothing is currently in progress.
>
> **Suggested next steps:**
>
> 1. `{{CMD_PREFIX}}feature-now <name>` — fast-track a new or inbox feature
> 2. `{{CMD_PREFIX}}board` — view the full Kanban board to pick what to work on next

---

### Path E: Ambiguous or unrecognised context

**Condition**: Branch name doesn't match any known pattern, or context is unclear

Fall back to showing the board and suggesting the user pick:
> Context is ambiguous (branch: `<branch>`).
>
> **Showing board instead:**

Run `aigon board` and display the output. Then suggest:
> Run `{{CMD_PREFIX}}board` for details, or `{{CMD_PREFIX}}feature-now <name>` to start something new.

---

## Step 4: Present the suggestion

- Display the suggestion(s) clearly as a ready-to-copy slash command
- If there are multiple plausible actions, show a short numbered list (max 3 options)
- Always include a one-line explanation of what the command does
- Do NOT auto-execute the suggested command — always let the user confirm
