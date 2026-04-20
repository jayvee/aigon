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

## Commit + record the review

Commit the spec edits, then record the review so the dashboard and engine see it. The commit is an audit artefact; `aigon spec-review submit` is the authoritative write:

```bash
git add "$SPEC_PATH"
git commit -m "spec-review: research {{ARG1_SYNTAX}} — <summary>" -m "Reviewer: ${AIGON_AGENT_ID:-unknown}

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

aigon spec-review submit research {{ARG1_SYNTAX}} \
  --reviewer="${AIGON_AGENT_ID}" \
  --summary="<summary>" \
  --commit-sha="$(git rev-parse HEAD)"
```

If `AIGON_AGENT_ID` is empty, stop and tell the user — the review cannot be recorded without a reviewer id.

## Report

Tell the user what you changed and why. End with:

`{{CMD_PREFIX}}research-spec-review-check {{ARG1_SYNTAX}}`
