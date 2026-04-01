<!-- description: Review feature <ID> - code review with fixes by a different agent -->
# aigon-feature-review

Perform a code review on another agent's implementation, making targeted fixes where needed.

**Use case**: After one agent implements a feature, a different agent reviews the code and commits fixes. This provides cross-agent quality assurance before merging.

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature:
1. Run `aigon feature-list --active`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Step 1: Verify you are on the feature branch

**CRITICAL: You MUST be on the feature branch, NEVER on main.** Run this check FIRST, before doing anything else:

```bash
BRANCH=$(git branch --show-current)
FEATURE_BRANCH=$(git branch --list 'feature-{{ARG1_SYNTAX}}-*' | head -1 | tr -d ' *')
echo "Current branch: $BRANCH"
echo "Feature branch: $FEATURE_BRANCH"
```

**If you are on the feature branch**, review files directly.

**If you are on main** (e.g. you cannot cd into the worktree), review using git commands:
- `git diff main...$FEATURE_BRANCH` to see the diff
- `git show $FEATURE_BRANCH:path/to/file` to read files from the branch
- `git log main..$FEATURE_BRANCH --oneline` to see commits
- Do NOT try to cd into the worktree directory — review from main using git.

## Step 2: Read the spec

Read the feature spec to understand what was supposed to be built:

```bash
SPEC_PATH=$(aigon feature-spec {{ARG1_SYNTAX}})
cat "$SPEC_PATH"
```

## Step 3: Read the implementation log

Read the implementing agent's log to understand their approach and decisions:

- Location: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`

## Step 4: Review the implementation

Examine all changes made on this branch:

```bash
git diff main...HEAD
```

Signal review start immediately:

```bash
aigon agent-status reviewing
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

**CRITICAL: Do NOT run `aigon feature-close` or `aigon feature-eval`.**

**THIS IS MANDATORY. YOU MUST RUN THIS COMMAND BEFORE REPORTING TO THE USER.**

After completing the review, run this command **immediately**:
```bash
aigon agent-status review-complete
```

Then tell the user: "Code review complete. [N] fix(es) committed." (or "Code review complete. No fixes needed.")
3. Show a summary of what was reviewed and any fixes made
4. **STOP and WAIT** for the user to:
   - Review your changes: `git log --oneline main..HEAD`
   - Inspect review commits: `git show <commit>`
   - Decide next steps

The user or original implementing agent should then:
- Review the fix commits
- Run `{{CMD_PREFIX}}feature-close {{ARG1_SYNTAX}}` when ready to merge

## Tips

- **Use a different model**: For best results, the reviewing agent should be a different model than the implementer (e.g., Claude implements → Codex reviews)
- **Do NOT run tests**: The implementing agent runs tests. Review is code review only.
- **Review commit history**: Use `git log --oneline main..HEAD` to see all implementation commits before reviewing

## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual ID:

`{{CMD_PREFIX}}feature-close <ID>`
