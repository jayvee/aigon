<!-- description: Review research spec <ID> - improve the research brief before execution -->
# aigon-research-spec-review

Review the research topic spec itself, not the findings. Edit the spec in place using the shared rubric below, then commit the reviewed spec with a `spec-review:` commit.

You are already inside the spec-review task for this research topic.

- Do not run `aigon research-spec-review {{ARG1_SYNTAX}}` again.
- Do not ask the shell to start the same command recursively.
- Use the resolved spec path below, edit that spec in place, then make the required `spec-review:` commit and run `aigon research-spec-review-record {{ARG1_SYNTAX}}`.
- If you cannot complete the commit or record step, stop and report the blocker instead of making a generic commit.

## Resolve the spec

```bash
SPEC_PATH=$(find docs/specs/research-topics -maxdepth 2 \( -name "research-{{ARG1_SYNTAX}}-*.md" -o -name "research-{{ARG1_SYNTAX}}.md" \) | head -1)
test -n "$SPEC_PATH" && echo "$SPEC_PATH"
```

If `SPEC_PATH` is empty, stop and report that the research spec could not be resolved.

Read the spec:

```bash
cat "$SPEC_PATH"
```

## Review rubric

{{SPEC_REVIEW_RUBRIC}}

## Review workflow

1. Resolve `SPEC_PATH`.
2. Read and edit `SPEC_PATH` directly.
3. Tighten the research questions, scope, evidence expectations, and output shape.
4. Keep edits targeted and in-place.
5. Clarify what a good findings document must contain without broadening the topic.
6. Verify `AIGON_AGENT_ID` is set before committing.
7. Commit with the exact `spec-review: research ...` format below.
8. Run `aigon research-spec-review-record {{ARG1_SYNTAX}}`.
9. Do not create any other commit message format.

Before committing, confirm the reviewer identity is available:

```bash
test -n "${AIGON_AGENT_ID:-}" || { echo "AIGON_AGENT_ID is required for spec-review commits"; exit 1; }
```

## Commit format

```bash
git add "$SPEC_PATH"
git commit -m "spec-review: research {{ARG1_SYNTAX}} — <summary>" -m "Reviewer: ${AIGON_AGENT_ID}

Summary:
- <high-level summary>

Strengths:
- <what was already strong>

Gaps:
- <what you tightened or clarified>

Risky decisions:
- <scope or methodological risks, or 'None'>

Suggested edits:
- <notable edits you made>"
aigon research-spec-review-record {{ARG1_SYNTAX}}
```

## Forbidden

- Running `aigon research-spec-review {{ARG1_SYNTAX}}` from inside this task
- Making a non-`spec-review:` commit
- Ending the task before `research-spec-review-record` succeeds

## Report

Tell the user what you changed and why. End with:

`{{CMD_PREFIX}}research-spec-review-check {{ARG1_SYNTAX}}`
