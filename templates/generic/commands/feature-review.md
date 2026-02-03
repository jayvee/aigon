<!-- description: Review feature <ID> - code review with fixes by a different agent -->
# aigon-feature-review

Perform a code review on another agent's implementation, making targeted fixes where needed.

**Use case**: After one agent implements a feature, a different agent reviews the code and commits fixes. This provides cross-agent quality assurance before merging.

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature:
1. List all files in `./docs/specs/features/03-in-progress/` and `./docs/specs/features/04-in-evaluation/` matching `feature-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Step 1: Locate the feature branch/worktree

Find the implementation to review:

```bash
# Check for worktrees first
git worktree list | grep "feature-{{ARG1_SYNTAX}}"

# If no worktree, check for branch
git branch --list "feature-{{ARG1_SYNTAX}}-*"
```

- **Worktree found**: `cd` into the worktree directory
- **Branch only**: Ensure you're on the feature branch (`git checkout feature-{{ARG1_SYNTAX}}-*`)

## Step 2: Read the spec

Read the feature spec to understand what was supposed to be built:

- Location: `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md` or `./docs/specs/features/04-in-evaluation/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Read the implementation log

Read the implementing agent's log to understand their approach and decisions:

- Location: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`

## Step 4: Review the implementation

Examine all changes made on this branch:

```bash
git diff main...HEAD
```

Enter **Code Review Mode** with these constraints:

### You MAY fix:
- Bugs or logic errors
- Missing edge cases from the spec's acceptance criteria
- Security issues (injection, XSS, CSRF, etc.)
- Obvious performance problems (N+1 queries, unnecessary loops)
- Failing tests
- Missing error handling for likely failure cases
- Typos in user-facing strings

### You must NOT:
- Refactor or restructure working code
- Change the architectural approach
- Add features beyond the spec
- Rewrite code in your preferred style
- Add comments/docs to code you didn't change
- "Improve" code that already works correctly

**The goal is targeted fixes, not a rewrite.**

## Step 5: Make fixes and commit

For each issue found:

1. Make the minimal fix
2. Commit with `fix(review):` prefix:
   ```bash
   git add <files>
   git commit -m "fix(review): <description of fix>"
   ```

Examples:
- `fix(review): handle null user in profile lookup`
- `fix(review): escape HTML in user-provided content`
- `fix(review): add missing await on async call`

**If the implementation is solid**: Commit nothing. A clean review is a valid outcome.

## Step 6: Update the implementation log

Add a review section to the implementation log:

```markdown
## Code Review

**Reviewed by**: <your agent ID>
**Date**: <date>

### Findings
- <list issues found, or "No issues found">

### Fixes Applied
- <list commits made, or "None needed">

### Notes
- <any observations for the user>
```

Commit the log update:
```bash
git add docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md
git commit -m "docs(review): add review notes to implementation log"
```

## Step 7: STOP - Review complete

**CRITICAL: Do NOT run `aigon feature-done` or `aigon feature-eval`.**

After completing the review:

1. Tell the user: "Code review complete. [N] fix(es) committed." (or "Code review complete. No fixes needed.")
2. Show a summary of what was reviewed and any fixes made
3. **STOP and WAIT** for the user to:
   - Review your changes: `git log --oneline main..HEAD`
   - Inspect review commits: `git show <commit>`
   - Decide next steps

The user or original implementing agent should then:
- Review the fix commits
- Run `{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}}` when ready to merge

## Tips

- **Use a different model**: For best results, the reviewing agent should be a different model than the implementer (e.g., Claude implements → Codex reviews)
- **Check tests**: Run the test suite if available to catch regressions
- **Review commit history**: Use `git log --oneline main..HEAD` to see all implementation commits before reviewing
