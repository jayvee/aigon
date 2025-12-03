<!-- description: Evaluate feature <ID> - submit for review -->
# aigon-feature-eval

Evaluate and compare multiple agent implementations of a feature.

> **Tip:** If using Claude as the evaluator, use a different model than the one that wrote the code to avoid bias. For example: `claude --model sonnet` to have Sonnet evaluate implementations written by Opus.

## Step 1: Run the CLI command

IMPORTANT: You MUST run this command first. This moves the spec to evaluation and creates the evaluation template.

```bash
aigon feature-eval {{ARG_SYNTAX}}
```

This will:
- Move the spec to `04-in-evaluation/` (if not already there)
- Create an evaluation template at `./docs/specs/features/evaluations/feature-{{ARG1_SYNTAX}}-eval.md`
- List all worktrees for this feature
- Commit the changes

## Step 2: Read the spec

Read the feature spec in `./docs/specs/features/04-in-evaluation/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Review each implementation

For each agent worktree listed:

1. Read the implementation log (if it exists):
   - Multi-agent: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-<agent>-log.md`
   - Solo: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-log.md`
2. **Examine the actual code changes** in each worktree - this is the primary source of truth
3. Run `git diaigonmain...HEAD` in each worktree to see all changes
4. Check if the implementation meets the spec requirements

**Worktree locations:** `../feature-{{ARG1_SYNTAX}}-<agent>-*`

**Note:** If logs are empty or missing, focus on examining the code directly. Use `git log --oneline` in each worktree to see commit history.

## Step 4: Write the evaluation

Update `./docs/specs/features/evaluations/feature-{{ARG1_SYNTAX}}-eval.md` with:

1. **Evaluation table** - Score each implementation on:
   - Code Quality
   - Spec Compliance
   - Performance
   - Maintainability

2. **Strengths & Weaknesses** for each agent's implementation

3. **Recommendation** - Your suggested winner and rationale

## Step 5: Present to user and STOP

After completing the evaluation:

1. Present a summary of your findings to the user
2. Show the scores/comparison
3. State your recommendation
4. **ASK the user**: "Which implementation would you like to merge?"
5. **STOP and WAIT** for the user's decision

**CRITICAL: Do NOT run `feature-done` automatically. The user must explicitly choose the winner.**

## Step 6: After user picks winner

Once the user has chosen, tell them to run (from the main repo, not a worktree):

```bash
aigon feature-done {{ARG_SYNTAX}} <winning-agent>
```

For example: `aigon feature-done {{ARG1_SYNTAX}} cc` if Claude's implementation wins.
