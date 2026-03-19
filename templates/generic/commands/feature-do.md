<!-- description: Do feature <ID> - works in both Drive and Fleet modes -->
# aigon-feature-do

Implement a feature. Works in Drive mode (branch), Drive mode (worktree) (parallel development), and Fleet mode (competition).

**IMPORTANT:** Run `{{CMD_PREFIX}}feature-setup <ID>` first to prepare your workspace.

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature in progress:
1. List all files in `./docs/specs/features/03-in-progress/` matching `feature-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Step 1: Run the CLI command

This command detects whether you're in Drive or Fleet mode and provides guidance.

```bash
aigon feature-do {{ARG1_SYNTAX}}
```

To run in **Autopilot mode** — autonomous retry loop where a fresh agent session is spawned each iteration until validation passes:

```bash
aigon feature-do {{ARG1_SYNTAX}} --autonomous
```

Optional flags: `--max-iterations=N` (default 5) · `--agent=<id>` · `--dry-run`

> **What is autonomous mode?** The autonomous technique runs an agent in a loop: implement → validate → if fail, repeat with fresh context until success or max iterations. Named after the [original pattern by Geoffrey Huntley](https://ghuntley.com/ralph/) and [similar implementations](https://github.com/minicodemonkey/chief) that treat autonomous iteration as the primary dev loop. Add a `## Validation` section to your feature spec to define feature-specific checks alongside project-level validation.

The command will:
- Detect your mode: Drive (branch), Drive worktree, or Fleet
- Display the spec location and log file
- Show implementation steps

**If the CLI fails with "Could not find feature in in-progress"** and you're in a worktree: the spec move was likely not committed before the worktree was created. Fix by running these commands from the worktree:
```bash
# Bring the spec into this worktree from the main branch
git checkout main -- docs/specs/features/03-in-progress/
git commit -m "chore: sync spec to worktree branch"
```
Then re-run `{{CMD_PREFIX}}feature-do {{ARG1_SYNTAX}}`.

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md`

## Step 2.5: Consider Plan Mode

For non-trivial features, **use plan mode** before implementation to explore the codebase and design your approach:

**Use plan mode when**:
- Feature touches 3+ files
- Architectural decisions required (choosing between patterns, libraries, approaches)
- Multiple valid implementation approaches exist
- Complex acceptance criteria requiring coordination across components
- Unclear how to integrate with existing codebase

**Skip plan mode for**:
- **Worktree or Fleet mode** — there is no interactive user to approve plans; implement directly
- Single-file changes with obvious implementation
- Clear, detailed specifications with one straightforward approach
- Simple bug fixes or small tweaks
- Very specific user instructions with implementation details provided

**In plan mode, you should**:
- Explore the codebase thoroughly (Glob, Grep, Read existing files)
- Understand existing patterns and conventions
- Design your implementation approach
- Identify files that need changes
- Present your plan for user approval
- Exit plan mode when ready to implement

## Step 3: Implement and break into tasks from acceptance criteria

**Signal that you are starting implementation (you MUST run this shell command — do NOT write .aigon/state/ files directly):**
```bash
aigon agent-status implementing
```

Before writing code, create a task for each **Acceptance Criterion** from the spec. This gives the user visibility into implementation progress via the task list.

Then implement the feature according to the spec. Mark tasks as in-progress when you start working on them, and completed when satisfied. If you discover sub-tasks during implementation, add them to the list.
{{AGENT_TEAMS_FEATURE_NOTE}}

**For worktree modes (Drive worktree or Fleet):** Use relative paths throughout implementation. Maintain the worktree directory as your working directory.

## Step 3.5: Install dependencies (worktree only)

{{WORKTREE_DEP_CHECK}}

> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for dependency commands.

## Step 3.8: Write tests for your implementation

**You MUST write tests for any new functionality you implement.** This is not optional. Test coverage is a key evaluation criterion in Fleet mode and a merge requirement.

- **Write unit tests** for new modules, functions, resolvers, and utilities
- **Write integration tests** for new UI components (render tests, interaction tests)
- **Add test cases** to existing test files when extending existing modules
- **Follow existing test patterns** — look at nearby `*.test.js`, `*.test.jsx`, or `*.test.ts` files for conventions (test runner, assertion style, mocking approach)
- **Run the test suite** to verify all tests pass (both new and existing)

> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for test commands and conventions.

## Step 4: Test your changes

### Drive Mode (branch)
- Start the dev server if needed
- Run the full test suite and verify all tests pass
- Ask the user to verify

### Worktree Mode (Drive worktree or Fleet)
{{WORKTREE_TEST_INSTRUCTIONS}}
{{AGENT_DEV_SERVER_NOTE}}
> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for test commands.

{{PLAYWRIGHT_VERIFICATION}}

{{MANUAL_TESTING_GUIDANCE}}

## Step 5: Commit your implementation

**IMPORTANT: You MUST commit before proceeding.**

**Before committing, verify your working directory:**
```bash
pwd
```

Expected output:
- Drive mode (branch): Main repository path
- Worktree mode: `.../feature-{{ARG1_SYNTAX}}-<agent>-<description>`

**Now commit your changes:**
1. Stage and commit your code changes using conventional commits (`feat:`, `fix:`, `chore:`)
2. Verify the commit was successful by running `git log --oneline -1`

## Step 6: Update and commit the log

Find your implementation log:
- Drive mode (branch): `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`
- Worktree mode: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-<agent>-*-log.md`

Update it with:
- Key decisions made during implementation
- Summary of the conversation between you and the user
- Any issues encountered and how they were resolved
- Your approach and rationale (for Fleet mode, helps evaluator compare)

**Then commit the log file.**

## Step 7: Signal completion

**THIS IS THE FINAL STEP. YOU MUST COMPLETE IT.**

**IMPORTANT:** You MUST use `aigon agent-status` CLI commands below — do NOT write `.aigon/state/` JSON files directly. The CLI resolves the correct target directory (main repo, not worktree).

After committing your code (Step 5) and log (Step 6), run this command to detect your mode and signal the correct status:

```bash
if test -f .aigon/auto-submit; then echo "AUTO_SUBMIT"; elif test -f .aigon/worktree.json; then echo "WORKTREE"; else echo "BRANCH"; fi
```

Then follow the **one** matching section below:

---

### AUTO_SUBMIT → signal done and exit

```bash
aigon agent-status submitted
```
This session is complete. Do not suggest follow-up commands.

---

### WORKTREE → signal done and stay

You are in a worktree (Drive worktree or Fleet). Run:
```bash
aigon agent-status submitted
```
Then tell the user:

> "Implementation complete — code is on the branch, ready for review. You can ask me to make changes here, or close the feature from the main repo when satisfied."

**STAY in the session.** The user may want to review your work and ask for changes. If they do, make the changes, commit, and say "Changes made and committed." No need to re-run agent-status — the status stays `submitted` and the branch tip always has the latest code.

Do NOT run or suggest `feature-close` — that's the user's decision from the main repo.

---

### BRANCH → signal done and stay

You are on a branch in the main repo (Drive branch mode). Run:
```bash
aigon agent-status submitted
```
Then tell the user:

> "Implementation complete — code is on the branch, ready for review. You can ask me to make changes, or run `/aigon:feature-close <ID>` when satisfied."

**STAY in the session.** The user may review and request changes. If they do, make the changes and commit. No need to re-run agent-status.

## Prompt Suggestion

End your final response with a brief summary of what was implemented (files changed, approach taken). Do NOT suggest a slash command — the user decides what to do next.
