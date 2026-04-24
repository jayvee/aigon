<!-- description: Review feature <ID> - code review with fixes by a different agent -->
# aigon-feature-code-review

Perform a code review on another agent's implementation, making targeted fixes where needed. Use a different model than the implementer for best results.

You are doing a write-capable review pass, not a read-only review report.
Ignore any default "code review means findings-only" behavior for this task; this command is specifically a review-with-fixes workflow.

Your default action is:
1. identify a concrete issue
2. patch it in the feature worktree
3. commit it with `fix(review): ...`
4. leave only residual issues in notes

Do not stop at describing a fix if you can safely make it yourself.
A findings-only review is valid only when:
- the implementation is genuinely clean
- the remaining issue requires a broader architectural or product decision
- the issue is ambiguous and the correct behavior is not clear from the spec
- you are blocked by missing context or infrastructure you cannot safely change

## Argument Resolution
If no ID is provided or doesn't match an active feature, run `aigon feature-list --active`, filter to matches, and ask the user.

## Step 1: Gather all context (one tool call)

**Run this entire block in a single shell execution** — do not split it up. It fetches branch info, the full diff, and the implementation log in one shot so you can review immediately without extra round-trips.

**You MUST commit review changes to the FEATURE WORKTREE, never to main.**

```bash
BRANCH=$(git branch --show-current)
FEATURE_BRANCH=$(git branch --list 'feature-{{ARG1_SYNTAX}}-*' | head -1 | tr -d ' *')
WORKTREE=$(git worktree list | grep "feature-{{ARG1_SYNTAX}}" | awk '{print $1}')
echo "=== WORKSPACE ==="
echo "Current: $BRANCH  Feature: $FEATURE_BRANCH  Worktree: $WORKTREE"
echo "=== DIFF ==="
git diff "main..${FEATURE_BRANCH:-HEAD}"
echo "=== IMPLEMENTATION LOG ==="
cat docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md 2>/dev/null || echo "(no log found)"
aigon agent-status reviewing
```

The spec body was printed inline by the launching CLI — use that copy for acceptance criteria.

If you are on the feature branch, review files directly. If you are on main, use `git diff main..$FEATURE_BRANCH` / `git show $FEATURE_BRANCH:path` — do NOT `cd` into the worktree. Commit fixes with `git -C "$WORKTREE" add ... && git -C "$WORKTREE" commit -m "fix(review): ..."` (review commits on main cause conflicts at `feature-close`).

## Step 1.5: Scope baseline check

Before reviewing correctness, check for out-of-scope deletions. The scope snapshot at `.aigon/state/feature-{{ARG1_SYNTAX}}-file-snapshot.txt` (in the main repo) lists every tracked file at feature-start time.

```bash
# Check for deleted files and test file deletions in the diff
git diff --name-status "main..${FEATURE_BRANCH:-HEAD}" | grep '^D'
```

**Check for out-of-scope deletions first**, then proceed to correctness review. Flag any files deleted that:
- Are not related to the feature spec
- Are test files (`.test.js`, `.test.ts`, `*.spec.*`)
- Are from a different feature's implementation

Revert out-of-scope deletions before reviewing the rest of the diff.

## Step 2: Review

### You MUST fix now when the change is:
- Bugs / logic errors
- Missing edge cases from the spec's acceptance criteria
- Security issues (injection, XSS, CSRF)
- Obvious performance problems (N+1, unnecessary loops)
- Failing tests
- Missing error handling for likely failures
- Typos in user-facing strings
- Missing test wiring, command wiring, config updates, or registration needed for the shipped change to actually be protected or reachable
- Obvious omissions in a touched mechanism, such as producer/read-path mismatches or incomplete doctor/bootstrap coverage that are local to this branch and safe to patch

### You MAY leave notes only when:
- the fix would change the architecture or expand feature scope
- the correct behavior is ambiguous
- the issue spans a separate subsystem and is not safely patchable in this review pass
- you are blocked by missing infrastructure, permissions, or context

### You must NOT
- Refactor or restructure working code
- Change the architectural approach
- Add features beyond the spec
- Rewrite in your preferred style
- Add comments/docs to code you didn't change
- "Improve" code that already works
- Run lint, tsc, or build checks — focus on diff review only
- **Add a regression test by default.** When a bug is found, first ask: can the producer API be hardened (stricter types, enums, removed dead branch) to make re-introduction impossible? If yes, fix the producer. Add a test only when the bug is subtle enough that PR review genuinely won't catch it.

**Targeted fixes, not a rewrite.**

## Step 3: Make fixes and commit

For each issue you can safely patch: make the minimal fix in the worktree, commit with `fix(review): <description>` (use `git -C "$WORKTREE"` if you're on main).

Examples: `fix(review): handle null user in profile lookup`, `fix(review): escape HTML in user-provided content`, `fix(review): add missing await on async call`.

**If the implementation is solid, commit nothing for code.** A clean review is a valid outcome.
If you report an issue without fixing it, explain why it was not safe or appropriate to patch in this review pass. Do not hand the implementer a to-do list for issues you could have fixed yourself.

## Step 4: Update the implementation log and commit

Append:

```markdown
## Code Review

**Reviewed by**: <your agent ID>
**Date**: <date>

### Fixes Applied
- <commits made, or "None needed">

### Residual Issues
- <only issues not fixed, with reason left unresolved, or "None">

### Notes
- <observations for the user>
```

Commit with `docs(review): add review notes to implementation log` (via `git -C "$WORKTREE"` if on main). Do not skip this even when no code fixes were needed — the review log entry is the audit trail for the autonomous controller and dashboard.

## Step 5: Signal completion (MANDATORY before reporting)

In order:
1. Commit every code fix with `fix(review): ...`
2. Commit the log update with `docs(review): ...`
3. Signal completion:

```bash
aigon agent-status review-complete
```

Then tell the user: "Code review complete. [N] fix(es) committed." (or "Code review complete. No fixes needed.") and show a summary.
Lead with the fixes you committed. List residual unfixed issues only after that, with a reason each one was left unresolved.

**CRITICAL: Do NOT run `aigon feature-close` or `aigon feature-eval`.**

The user or original implementing agent should then review your fix commits and run `{{CMD_PREFIX}}feature-code-revise <ID>` in the implementer's session (using that agent's native invocation — slash command for {{AGENT_IDS_SLASH_COMMAND}}, skill command for {{AGENT_IDS_SKILL}}) so the implementer reads the review and decides accept/challenge/modify. When ready to merge, they run `{{CMD_PREFIX}}feature-close {{ARG1_SYNTAX}}`.

## Prompt Suggestion

End your response with the suggested next command on its own line:

`{{CMD_PREFIX}}feature-code-revise <ID>`
