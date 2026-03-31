<!-- description: Do feature <ID> - works in both Drive and Fleet modes -->
# aigon-feature-do

Implement a feature. Works in Drive mode (branch), Drive mode (worktree) (parallel development), and Fleet mode (competition).

**IMPORTANT:** Run `{{CMD_PREFIX}}feature-start <ID>` first to prepare your workspace.

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing active feature:
1. Run `aigon feature-list --active`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Step 0: Verify your workspace (MANDATORY)

Before doing ANYTHING else, verify you are on the correct branch — **never implement on `main`**.

```bash
git branch --show-current
```

**Expected**: A branch named `feature-<ID>-<agent>-<description>` (e.g., `feature-55-gg-add-auth`).

**If the output is `main` or `master`:** STOP. You are on the wrong branch. Do NOT write any code. Instead:
1. Check if a feature branch already exists: `git branch | grep feature-{{ARG1_SYNTAX}}`
2. If it exists, switch to it: `git checkout feature-{{ARG1_SYNTAX}}-{{AGENT_ID}}-*` (use the full branch name from the list)
3. If it does NOT exist, the workspace was not set up — run `{{CMD_PREFIX}}feature-start {{ARG1_SYNTAX}}` first

Also verify your working directory:
```bash
pwd
```

**Expected for worktree mode**: A path ending in `feature-{{ARG1_SYNTAX}}-{{AGENT_ID}}-<description>`
**Expected for Drive mode**: The main repository path (but on a feature branch, NOT main)

**Do not proceed past this step until you have confirmed you are on a feature branch.**

## Step 1: Run the CLI command

This command detects whether you're in Drive or Fleet mode and provides guidance.

```bash
aigon feature-do {{ARG1_SYNTAX}}
```

{{AUTONOMOUS_SECTION}}

The command will detect your mode (Drive/worktree/Fleet) and display the spec location.

{{TROUBLESHOOTING_SECTION}}

## Step 2: Read the spec

Read the exact spec path returned by:

```bash
aigon feature-spec {{ARG1_SYNTAX}}
```

{{PLAN_MODE_SECTION}}

## Step 3: Implement and break into tasks from acceptance criteria

**Signal that you are starting implementation (you MUST run this shell command — do NOT write .aigon/state/ files directly):**
```bash
aigon agent-status implementing
```

Before writing code, create a task for each **Acceptance Criterion** from the spec. This gives the user visibility into implementation progress via the task list.

Then implement the feature according to the spec. Mark tasks as in-progress when you start working on them, and completed when satisfied.
{{AGENT_TEAMS_FEATURE_NOTE}}

**For worktree modes (Drive worktree or Fleet):** Use relative paths throughout implementation. Maintain the worktree directory as your working directory.

## Step 3.5: Install dependencies (worktree only)

{{WORKTREE_DEP_CHECK}}

> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for dependency commands.

{{TESTING_WRITE_SECTION}}

{{TESTING_STEPS_SECTION}}

{{DOCUMENTATION_SECTION}}

{{TESTING_RUN_SECTION}}

## Step 5: Commit your implementation

Stage and commit your code changes using conventional commits (`feat:`, `fix:`, `chore:`). Verify with `git log --oneline -1`.

{{LOGGING_SECTION}}

{{DEV_SERVER_SECTION}}

## Step 7: Signal completion

**THIS IS THE FINAL STEP. YOU MUST COMPLETE IT. DO NOT SKIP THIS STEP.**

After committing your code, run this command **immediately**:

```bash
aigon agent-status submitted
```

This signals to the dashboard that your work is done.

Then tell the user: "Implementation complete — ready for review."

**STAY in the session.** The user may request changes. If they do, make the changes, commit, and say "Changes committed." Do NOT run or suggest `feature-close` — that's the user's decision. End with a brief summary of what was implemented.
