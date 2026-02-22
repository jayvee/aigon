<!-- description: Submit feature implementation - commit changes, write log, signal done -->
# aigon-feature-submit

Wrap up implementation in the current worktree or branch: commit all changes, write the implementation log, and signal readiness for evaluation.

**Use this after testing is complete** — replaces manually asking "commit your changes and write up your log".

## Step 1: Detect feature context

```bash
aigon feature-implement --info 2>/dev/null || true
```

If that fails, detect from the current branch name:
```bash
git branch --show-current
```

Extract the feature ID and agent code from the branch name (pattern: `feature-<ID>-<agent>-<description>`).

{{STOP_DEV_SERVER_STEP}}

## Commit implementation changes

**Before committing, verify your working directory:**
```bash
pwd
git status
```

Stage and commit all code changes using conventional commits:
1. Stage all modified and new files (excluding log files)
2. Create a commit with a meaningful `feat:` or `fix:` message summarizing the implementation
3. Verify the commit: `git log --oneline -1`

If there are no uncommitted changes, skip this step (changes may already be committed).

## Update the implementation log

Find the log file:
- Solo mode: `./docs/specs/features/logs/feature-<ID>-*-log.md`
- Worktree mode: `./docs/specs/features/logs/feature-<ID>-<agent>-*-log.md`

Update it with a thorough writeup:

### Plan
- The overall approach taken to implement the feature

### Progress
- What was implemented (reference specific files and components)
- What works and has been tested

### Decisions
- Key decisions made during implementation and their rationale
- Any trade-offs or alternatives considered
- Issues encountered and how they were resolved

**Then commit the log file:**
```bash
git add docs/specs/features/logs/
git commit -m "docs: update implementation log for feature <ID>"
```

## Signal completion

**First, detect the mode by counting worktrees:**
```bash
git worktree list | grep -c "feature-<ID>-"
```

Replace `<ID>` with the actual feature ID (padded with leading zero if needed, e.g., "01").

**Then tell the user based on the mode:**

**If 2+ worktrees exist (Arena Mode):**

> Implementation submitted ✅
>
> Changes committed and log written.
>
> **Next step for you:** Switch back to the main repo session and run `/aigon:feature-eval <ID>` from there to compare all implementations.

**If only 1 worktree exists (Solo Worktree Mode):**

> Implementation submitted ✅
>
> Changes committed and log written.
>
> **Next step for you:** Switch back to the main repo session and run `/aigon:feature-done <ID>` to merge your implementation.

**STOP here. Do NOT:**
- Run `aigon feature-done` from this worktree
- Run `aigon feature-eval` from this worktree
- Push to remote
- Start any new work

**This session is complete. Do not suggest any follow-up commands.**
