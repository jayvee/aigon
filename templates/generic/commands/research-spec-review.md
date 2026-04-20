<!-- description: Review research spec <ID> - improve the research brief before execution -->
# aigon-research-spec-review

Review the research topic spec itself, not the findings. Edit the spec in place using the shared rubric below, then commit the reviewed spec with a `spec-review:` commit.

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

1. Tighten the research questions, scope, evidence expectations, and output shape.
2. Keep edits targeted and in-place.
3. Clarify what a good findings document must contain without broadening the topic.

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

## Report

Tell the user what you changed and why. End with:

`{{CMD_PREFIX}}research-spec-review-check {{ARG1_SYNTAX}}`
