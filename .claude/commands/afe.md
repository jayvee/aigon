---
description: Evaluate feature <ID> - code review or comparison (shortcut for feature-eval)
argument-hint: "<ID> [--allow-same-model-judge] [--force]"
---
# aigon-feature-eval

Evaluate a feature implementation. Works in both Drive mode (code review) and Fleet mode (comparison).

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature:
1. Run `aigon feature-list --active`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Step 1: Run the CLI command

IMPORTANT: You MUST run this command first.

```bash
aigon feature-eval {{args}}
```

Optional overrides:

```bash
aigon feature-eval {{args}} --allow-same-model-judge
```

This will:
- Move the spec to `04-in-evaluation/` (if not already there)
- Create an evaluation template at `./docs/specs/features/evaluations/feature-{{args}}-eval.md`
- Detect mode (Drive or Fleet)
- Warn if the evaluator shares a provider family with the implementer (same-family bias detection)
- Commit the changes

**IMPORTANT:** After the CLI command completes, open the evaluation file in markdown preview mode in a separate window:
- File: `./docs/specs/features/evaluations/feature-{{args}}-eval.md`
- Open the file, then use Cursor's command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run: `Markdown: Open Preview` (or press `Cmd+Shift+V` / `Ctrl+Shift+V`)
- This will open the markdown preview in a separate window for easy reference while you work

## Step 2: Read the spec

Read the exact feature spec path returned by:

```bash
aigon feature-spec {{args}}
```

## Step 3: Review the implementation(s)

### Drive Mode (Code Review)

Review the single implementation:

1. Read the implementation log: `./docs/specs/features/logs/feature-{{args}}-*-log.md`
2. Review the code changes: `git diff main..feature-{{args}}-*`
3. Check if the implementation meets the spec requirements
4. Verify code quality, testing, documentation, security

### Fleet Mode (Comparison)

Review each agent's implementation:

1. For each agent worktree listed:
   - Read implementation log from the worktree (e.g., `../feature-{{args}}-cc-*/docs/specs/features/logs/feature-{{args}}-cc-*-log.md`)
   - **Examine the actual code changes** in each worktree
   - Run `git diff main..HEAD` in each worktree to see all changes
   - Check spec compliance

2. **Worktree locations:** `../feature-{{args}}-<agent>-*`

> **Bias guard:** `feature-eval` detects same-family evaluation and warns automatically. Pass `--allow-same-model-judge` to suppress if intentional.

## Step 4: Write the evaluation

Update `./docs/specs/features/evaluations/feature-{{args}}-eval.md`:

### Drive Mode

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

### Fleet Mode

Write the evaluation using this exact structure. Copy each template table below and fill in the values.

**Scoring table** — score each criterion out of 10:

```markdown
| Criteria | cx | gg |
|---|---|---|
| Code Quality | /10 | /10 |
| Spec Compliance | /10 | /10 |
| Performance | /10 | /10 |
| Maintainability | /10 | /10 |
| **Total** | **/40** | **/40** |
```

**Summary table** — lines changed and total score per agent:

```markdown
| Agent | Lines | Score |
|---|---|---|
| cx | | /40 |
| gg | | /40 |
```

Adjust agent columns to match the actual agents being evaluated.

**IMPORTANT formatting rules:**
- Use standard GFM markdown tables (`| col | col |` with `|---|---|` separator rows) exactly as shown above
- Do NOT use Unicode box-drawing characters (`┌─┬─┐`, `│`, `├─┼─┤`, `└─┴─┘`) — they break dashboard rendering
- Do NOT wrap tables in code fences — write them as raw markdown so they render as HTML tables

After the tables, document:
- **Strengths & Weaknesses** for each agent (use `####` agent headings with bullet lists)
- **Recommendation** — which agent wins and why (1-2 sentences)

## Step 5: Present evaluation and close

### Autonomous Mode (`--autonomous` flag)

If `--autonomous` was passed in the CLI command, skip all user interaction and:

1. Pick the winning implementation based on your evaluation scores (highest total wins; break ties by code quality)
2. Document your choice in the evaluation file under a `## Winner` heading: `Winner: <agent>` (e.g., `Winner: cc`)
3. Run close automatically — **from the main repo, not a worktree**:
   ```bash
   aigon feature-close {{args}} <winning-agent>
   ```
4. State which implementation you chose and why
5. **Do NOT ask the user for input** — the AutoConductor expects autonomous completion

### Drive Mode (interactive)

After completing the evaluation:

1. Present a summary of your review to the user
2. Highlight strengths and any concerns
3. State your recommendation (Approved / Needs Changes)
4. **ASK the user**: "Would you like to proceed with merging this implementation?"
5. **STOP and WAIT** for the user's decision

**CRITICAL: Do NOT run `feature-close` automatically.**

Once the user approves, tell them to run:

```
/aigon:feature-close {{args}}
```

### Fleet Mode (interactive)

After completing the evaluation:

1. Present a summary of your comparison to the user
2. Show the scores/comparison
3. State your recommendation clearly (e.g., "Merge cc's implementation")
4. **Explicitly address cross-pollination:** After naming the winner, you MUST state one of:
   - **If there are aspects worth adopting:** "Before merging, consider adopting from `<agent>`: `<specific aspect>`" — be concrete about what to take and from which implementation.
   - **If there is nothing worth adopting:** "The other implementations don't have particular features or aspects worth adopting beyond what the winner already provides."
   Do NOT skip this step or leave it ambiguous. The user needs a clear, actionable statement.
5. **ASK the user**: "Which implementation would you like to merge?"
6. **STOP and WAIT** for the user's decision

**CRITICAL: Do NOT run `feature-close` automatically. The user must explicitly choose the winner.**

Once the user has chosen, tell them to run (from the main repo, not a worktree):

```
/aigon:feature-close {{args}} <winning-agent>
```

For example: `/aigon:feature-close {{args}} cc` if Claude's implementation wins.

## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual ID:

- **Drive mode:** `/aigon:feature-close <ID>`
- **Fleet mode:** `/aigon:feature-close <ID> <winning-agent>`
