---
description: Review research <ID> - review findings with a different agent
---
# aigon-research-review

Review research findings for rigor, completeness, and accuracy, making targeted improvements where needed.

**Use case**: After research agents submit their findings, a different agent reviews the quality of the research and refines the findings. This provides cross-agent quality assurance before evaluation.

## Argument Resolution

If no ID is provided, or the ID doesn't match existing research:
1. Run `aigon research-list --active`
2. If a partial ID or name was given, filter to matches
3. Present the matching research and ask the user to choose one

## Step 1: Run the CLI command

```bash
aigon research-review {{args}}
```

## Step 2: Read the research spec

Read the research topic spec to understand what was being investigated:

```bash
SPEC_PATH=$(aigon research-spec {{args}})
cat "$SPEC_PATH"
```

## Step 3: Read the findings

Read all agent findings files to understand what was researched:

```bash
ls docs/specs/research/logs/research-{{args}}-*-findings.md
```

Read each findings file.

## Step 4: Review the findings

Signal review start immediately:

```bash
aigon agent-status reviewing
```

Enter **Research Review Mode** with this checklist:

### Methodology rigor
- Are the research methods sound and appropriate for the questions asked?
- Are conclusions supported by the evidence presented?
- Are there logical gaps or unsupported claims?

### Completeness
- Are all research questions from the spec addressed?
- Are there obvious gaps or areas that were skipped?
- Are edge cases and alternative perspectives considered?

### Accuracy
- Are factual claims verifiable?
- Are sources cited where appropriate?
- Are there contradictions within the findings?

### Evidence quality
- Is the evidence sufficient to support the conclusions?
- Are examples concrete and relevant?
- Are trade-offs honestly presented?

## Step 5: Make refinements

### You MAY:
- Correct factual errors
- Add missing evidence or citations
- Fill gaps in coverage of research questions
- Add nuance to oversimplified conclusions
- Correct logical errors in reasoning
- Add missing edge cases or counterpoints

### You must NOT:
- Change the research direction or scope
- Rewrite findings in your preferred style
- Remove conclusions you disagree with (add counterpoints instead)
- Add entirely new research topics not in the spec
- Restructure the document organisation

**The goal is targeted refinement, not a rewrite.**

For each improvement, commit with `fix(review):` prefix:
```bash
git add <files> && git commit -m "fix(review): <description of improvement>"
```

**If the findings are solid**: Commit nothing. A clean review is a valid outcome.

## Step 6: STOP - Review complete

**CRITICAL: Do NOT run `aigon research-close` or `aigon research-eval`.**

**THIS IS MANDATORY. YOU MUST RUN THIS COMMAND BEFORE REPORTING TO THE USER.**

After completing the review, run this command **immediately**:
```bash
aigon agent-status review-complete
```

Then tell the user: "Research review complete. [N] refinement(s) committed." (or "Research review complete. No refinements needed.")

Show a summary of what was reviewed and any improvements made.

**STOP and WAIT** for the user to decide next steps.

## Prompt Suggestion

End your response with the suggested next command on its own line:

`/aigon:research-eval <ID>`
