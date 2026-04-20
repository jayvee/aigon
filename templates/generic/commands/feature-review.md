<!-- description: Review feature <ID> - code review with fixes by a different agent -->
# aigon-feature-review

Perform a code review on another agent's implementation, making targeted fixes where needed. Use a different model than the implementer for best results.

## Argument Resolution
If no ID is provided or doesn't match an active feature, run `aigon feature-list --active`, filter to matches, and ask the user.

## Step 1: Locate the branch

**You MUST commit review changes to the FEATURE WORKTREE, never to main.** Find the branch and worktree:

```bash
BRANCH=$(git branch --show-current)
FEATURE_BRANCH=$(git branch --list 'feature-{{ARG1_SYNTAX}}-*' | head -1 | tr -d ' *')
WORKTREE=$(git worktree list | grep "feature-{{ARG1_SYNTAX}}" | awk '{print $1}')
```

If you are on the feature branch, review files directly. If you are on main, review using `git diff main..$FEATURE_BRANCH` / `git show $FEATURE_BRANCH:path` — do NOT `cd` into the worktree from main. Commit any fixes with `git -C "$WORKTREE" add ... && git -C "$WORKTREE" commit -m "fix(review): ..."`. Review commits on main cause conflicts at `feature-close`.

## Step 2: Read the spec and implementation log

The spec body was printed inline by the launching CLI — use that copy. Then read `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md` for the implementer's approach.

## Step 3: Review

```bash
git diff main..HEAD     # or main..$FEATURE_BRANCH from main
aigon agent-status reviewing
```

### You MAY fix
- Bugs / logic errors
- Missing edge cases from the spec's acceptance criteria
- Security issues (injection, XSS, CSRF)
- Obvious performance problems (N+1, unnecessary loops)
- Failing tests
- Missing error handling for likely failures
- Typos in user-facing strings

### You must NOT
- Refactor or restructure working code
- Change the architectural approach
- Add features beyond the spec
- Rewrite in your preferred style
- Add comments/docs to code you didn't change
- "Improve" code that already works

**Targeted fixes, not a rewrite.**

## Step 4: Make fixes and commit

For each issue: make the minimal fix in the worktree, commit with `fix(review): <description>` (use `git -C "$WORKTREE"` if you're on main).

Examples: `fix(review): handle null user in profile lookup`, `fix(review): escape HTML in user-provided content`, `fix(review): add missing await on async call`.

**If the implementation is solid, commit nothing for code.** A clean review is a valid outcome.

## Step 5: Update the implementation log and commit

Append:

```markdown
## Code Review

**Reviewed by**: <your agent ID>
**Date**: <date>

### Findings
- <issues found, or "No issues found">

### Fixes Applied
- <commits made, or "None needed">

### Notes
- <observations for the user>
```

Commit with `docs(review): add review notes to implementation log` (via `git -C "$WORKTREE"` if on main). Do not skip this even when no code fixes were needed — the review log entry is the audit trail for the autonomous controller and dashboard.

## Step 6: Signal completion (MANDATORY before reporting)

In order:
1. Commit every code fix with `fix(review): ...`
2. Commit the log update with `docs(review): ...`
3. Signal completion:

```bash
aigon agent-status review-complete
```

Then tell the user: "Code review complete. [N] fix(es) committed." (or "Code review complete. No fixes needed.") and show a summary.

**CRITICAL: Do NOT run `aigon feature-close` or `aigon feature-eval`.**

The user or original implementing agent should then review your fix commits and run `{{CMD_PREFIX}}feature-review-check <ID>` in the implementer's session (using that agent's native invocation — slash command for {{AGENT_IDS_SLASH_COMMAND}}, skill command for {{AGENT_IDS_SKILL}}) so the implementer reads the review and decides accept/challenge/modify. When ready to merge, they run `{{CMD_PREFIX}}feature-close {{ARG1_SYNTAX}}`.

## Prompt Suggestion

End your response with the suggested next command on its own line:

`{{CMD_PREFIX}}feature-review-check <ID>`
