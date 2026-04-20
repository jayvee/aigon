<!-- description: Check pending research spec reviews and acknowledge them in one pass -->
# aigon-research-spec-review-check

You are the author-side agent. Review all pending `spec-review:` commits on the research spec, decide what to keep, and land one acknowledgement commit.

## Resolve the spec

```bash
SPEC_PATH=$(find docs/specs/research-topics -maxdepth 2 \( -name "research-{{ARG1_SYNTAX}}-*.md" -o -name "research-{{ARG1_SYNTAX}}.md" \) | head -1)
test -n "$SPEC_PATH" && echo "$SPEC_PATH"
```

If `SPEC_PATH` is empty, stop and report that the research spec could not be resolved.

## Find pending reviews

```bash
cat .aigon/workflows/research/{{ARG1_SYNTAX}}/spec-review.json 2>/dev/null || echo '{"reviews": []}'
git log --follow --format='%H %s' -- "$SPEC_PATH"
```

For a specific review commit:

```bash
git show <sha> -- "$SPEC_PATH"
git show -s --format=%B <sha>
```

## Decide in one pass

Process all pending reviewers together. Accept, revert, or modify the reviewed changes, then leave the spec in its final state.

## Acknowledge the reviews

Commit the spec (audit trail) and record the ack:

```bash
git add "$SPEC_PATH"
git commit --allow-empty -m "spec-review-check: research {{ARG1_SYNTAX}} — <decision summary>" -m "reviewed: <comma-separated reviewer ids>

Decision:
- <accept|revert|modify summary>

Notes:
- <important rationale>"

aigon spec-review ack research {{ARG1_SYNTAX}} \
  --acked-by="${AIGON_AGENT_ID:-unknown}" \
  --notes="<short decision summary>" \
  --commit-sha="$(git rev-parse HEAD)"
```

## Report

Tell the user:

1. Which pending reviews you processed.
2. Whether you accepted, reverted, or modified the reviewed changes.
3. Any follow-up edits you made to the spec.
