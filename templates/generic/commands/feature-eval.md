<!-- description: Evaluate feature <ID> - code review or comparison -->
# aigon-feature-eval

Evaluate a feature implementation. Works in both solo mode (code review) and arena mode (comparison).

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature:
1. List all files in `./docs/specs/features/03-in-progress/` and `./docs/specs/features/04-in-evaluation/` matching `feature-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Step 1: Run the CLI command

IMPORTANT: You MUST run this command first.

```bash
aigon feature-eval {{ARG1_SYNTAX}}
```

This will:
- Move the spec to `04-in-evaluation/` (if not already there)
- Create an evaluation template at `./docs/specs/features/evaluations/feature-{{ARG1_SYNTAX}}-eval.md`
- Detect mode (solo or arena)
- Commit the changes

## Step 2: Read the spec

Read the feature spec in `./docs/specs/features/04-in-evaluation/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Review the implementation(s)

### Solo Mode (Code Review)

Review the single implementation:

1. Read the implementation log: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`
2. Review the code changes: `git diff main...feature-{{ARG1_SYNTAX}}-*`
3. Check if the implementation meets the spec requirements
4. Verify code quality, testing, documentation, security

### Arena Mode (Comparison)

Review each agent's implementation:

1. For each agent worktree listed:
   - Read implementation log from the worktree (e.g., `../feature-{{ARG1_SYNTAX}}-cc-*/docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-cc-*-log.md`)
   - **Examine the actual code changes** in each worktree
   - Run `git diff main...HEAD` in each worktree to see all changes
   - Check spec compliance

2. **Worktree locations:** `../feature-{{ARG1_SYNTAX}}-<agent>-*`

> **Tip:** If using Claude as the evaluator, use a different model than the one that implemented to avoid bias.

## Step 4: Write the evaluation

Update `./docs/specs/features/evaluations/feature-{{ARG1_SYNTAX}}-eval.md`:

### Solo Mode

Complete the code review checklist:
- Spec Compliance
- Code Quality
- Testing
- Documentation
- Security

Add notes on:
- Strengths
- Areas for Improvement
- Approval decision (Approved / Needs Changes)

### Arena Mode

Fill in the evaluation table scoring each implementation on:
- Code Quality
- Spec Compliance
- Performance
- Maintainability

Document:
- Strengths & Weaknesses for each agent
- Your recommendation for the winner

## Step 5: Present evaluation and STOP

### Solo Mode

After completing the evaluation:

1. Present a summary of your review to the user
2. Highlight strengths and any concerns
3. State your recommendation (Approved / Needs Changes)
4. **ASK the user**: "Would you like to proceed with merging this implementation?"
5. **STOP and WAIT** for the user's decision

**CRITICAL: Do NOT run `feature-done` automatically.**

Once the user approves, tell them to run:

```
{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}}
```

### Arena Mode

After completing the evaluation:

1. Present a summary of your comparison to the user
2. Show the scores/comparison
3. State your recommendation
4. **ASK the user**: "Which implementation would you like to merge?"
5. **STOP and WAIT** for the user's decision

**CRITICAL: Do NOT run `feature-done` automatically. The user must explicitly choose the winner.**

Once the user has chosen, tell them to run (from the main repo, not a worktree):

```
{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}} <winning-agent>
```

For example: `{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}} cc` if Claude's implementation wins.

## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual ID:

- **Solo mode:** `{{CMD_PREFIX}}feature-done <ID>`
- **Arena mode:** `{{CMD_PREFIX}}feature-done <ID> <winning-agent>`
