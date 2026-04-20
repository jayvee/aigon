<!-- description: Evaluate feature <ID> - code review or comparison -->
# aigon-feature-eval

Evaluate a feature implementation. Works in Drive mode (code review) and Fleet mode (comparison).

## Argument Resolution
If no ID is provided or doesn't match an active feature, run `aigon feature-list --active`, filter to matches, and ask the user which.

## Step 1: Run the CLI

```bash
aigon feature-eval {{ARG1_SYNTAX}}
# optional: --allow-same-model-judge    # suppress same-family bias warning
```

This moves the spec to `04-in-evaluation/`, creates `./docs/specs/features/evaluations/feature-{{ARG1_SYNTAX}}-eval.md`, detects mode (Drive or Fleet), warns on same-family evaluator/implementer, and commits. The spec body is printed inline — use that copy; do not re-run `aigon feature-spec`.

## Step 2: Review the implementation(s)

### Drive Mode (code review)
1. Read the implementation log: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`
2. `git diff main..feature-{{ARG1_SYNTAX}}-*`
3. Check spec compliance, code quality, testing, documentation, security.

### Fleet Mode (comparison)
For each agent worktree at `../feature-{{ARG1_SYNTAX}}-<agent>-*`:
- Read the implementation log from the worktree
- Run `git diff main..HEAD` in each worktree
- Check spec compliance

> **Bias guard:** `feature-eval` warns automatically on same-family eval. Pass `--allow-same-model-judge` to suppress if intentional.

## Step 3: Write the evaluation

Update `./docs/specs/features/evaluations/feature-{{ARG1_SYNTAX}}-eval.md`.

### Drive Mode
Complete the checklist (Spec Compliance, Code Quality, Testing, Documentation, Security) and add Strengths, Areas for Improvement, and an Approval decision (Approved / Needs Changes).

### Fleet Mode
Use this exact structure — scoring table, then summary table, then Strengths/Weaknesses, then Recommendation.

```markdown
| Criteria | cx | gg |
|---|---|---|
| Code Quality | /10 | /10 |
| Spec Compliance | /10 | /10 |
| Performance | /10 | /10 |
| Maintainability | /10 | /10 |
| **Total** | **/40** | **/40** |
```

```markdown
| Agent | Lines | Score |
|---|---|---|
| cx | | /40 |
| gg | | /40 |
```

Adjust agent columns to match the actual agents. Use standard GFM pipe tables (not Unicode box-drawing) and do NOT wrap them in code fences — the dashboard needs raw markdown to render as HTML tables.

After the tables, include per-agent Strengths & Weaknesses (`####` headings) and a 1-2 sentence Recommendation.

## Step 4: Present and STOP

### Drive Mode
Summarise your review, highlight concerns, state your recommendation, then **ask**: "Would you like to proceed with merging this implementation?" and **WAIT**.

**Do NOT run `feature-close` automatically.** Once the user approves, tell them to run `{{CMD_PREFIX}}feature-close {{ARG1_SYNTAX}}`.

### Fleet Mode
Summarise the comparison, show scores, state your recommendation, and update `**Winner:**` in the eval file with the winning agent code (e.g., `**Winner:** cc (Claude) — rationale`).

**Explicitly address cross-pollination** — you MUST state one of:
- "Before merging, consider adopting from `<agent>`: `<specific aspect>`" (be concrete), or
- "The other implementations don't have particular features or aspects worth adopting beyond what the winner already provides."

Then **ask**: "Which implementation would you like to merge?" and **WAIT**. Do NOT run `feature-close` automatically. Once chosen, tell them to run (from the main repo, not a worktree): `{{CMD_PREFIX}}feature-close {{ARG1_SYNTAX}} <winning-agent>`.

## Prompt Suggestion

End your response with the next command on its own line:
- **Drive:** `{{CMD_PREFIX}}feature-close <ID>`
- **Fleet:** `{{CMD_PREFIX}}feature-close <ID> <winning-agent>`
