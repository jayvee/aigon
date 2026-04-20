<!-- description: Review feature spec <ID> - improve the spec itself before implementation -->
# aigon-feature-spec-review

Review the feature spec itself, not the code. Edit the spec in place using the shared rubric below, then commit the reviewed spec with a `spec-review:` commit.

## Resolve the spec

```bash
SPEC_PATH=$(aigon feature-spec {{ARG1_SYNTAX}} 2>/dev/null || true)
if [ -z "$SPEC_PATH" ]; then
  SPEC_PATH=$(find docs/specs/features -maxdepth 2 \( -name "feature-{{ARG1_SYNTAX}}-*.md" -o -name "feature-{{ARG1_SYNTAX}}.md" \) | head -1)
fi
test -n "$SPEC_PATH" && echo "$SPEC_PATH"
```

If `SPEC_PATH` is empty, stop and report that the feature spec could not be resolved.

Read the spec before editing:

```bash
cat "$SPEC_PATH"
```

## Review rubric

{{SPEC_REVIEW_RUBRIC}}

## Review workflow

1. Read the full spec carefully.
2. Make targeted edits in place.
3. Preserve author intent unless it is ambiguous, contradictory, or clearly under-specified.
4. Prefer tightening acceptance criteria, execution order, ownership, and edge cases over adding net-new scope.

## Commit + record the review

Commit exactly once after your spec edits, then record the review so the dashboard and engine see it. The commit is an audit artefact; `aigon spec-review submit` is the authoritative write:

```bash
git add "$SPEC_PATH"
git commit -m "spec-review: feature {{ARG1_SYNTAX}} — <summary>" -m "Reviewer: ${AIGON_AGENT_ID:-unknown}

Summary:
- <high-level summary>

Strengths:
- <what was already strong>

Gaps:
- <what you tightened or clarified>

Risky decisions:
- <scope or architectural risks, or 'None'>

Suggested edits:
- <notable edits you made>"

aigon spec-review submit feature {{ARG1_SYNTAX}} \
  --reviewer="${AIGON_AGENT_ID}" \
  --summary="<summary>" \
  --commit-sha="$(git rev-parse HEAD)"
```

If `AIGON_AGENT_ID` is empty, stop and tell the user — the review cannot be recorded without a reviewer id.

## Report

Tell the user what you changed and why. End with:

`{{CMD_PREFIX}}feature-spec-review-check {{ARG1_SYNTAX}}`
