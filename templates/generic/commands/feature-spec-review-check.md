<!-- description: Check pending feature spec reviews and acknowledge them in one pass -->
# aigon-feature-spec-review-check

You are the author-side agent. Review all pending `spec-review:` commits on the feature spec, decide what to keep, and land one acknowledgement commit.

## Resolve the spec

```bash
SPEC_PATH=$(aigon feature-spec {{ARG1_SYNTAX}} 2>/dev/null || true)
if [ -z "$SPEC_PATH" ]; then
  SPEC_PATH=$(find docs/specs/features -maxdepth 2 \( -name "feature-{{ARG1_SYNTAX}}-*.md" -o -name "feature-{{ARG1_SYNTAX}}.md" \) | head -1)
fi
test -n "$SPEC_PATH" && echo "$SPEC_PATH"
```

If `SPEC_PATH` is empty, stop and report that the feature spec could not be resolved.

## Find pending reviews

Pending reviews live in `.aigon/workflows/features/<id>/spec-review.json` (the authoritative store). Inspect what is pending:

```bash
cat .aigon/workflows/features/{{ARG1_SYNTAX}}/spec-review.json 2>/dev/null || echo '{"reviews": []}'
```

For context, you may also browse the audit commits:

```bash
git log --follow --format='%H %s' -- "$SPEC_PATH"
```

For a specific review commit:

```bash
git show <sha> -- "$SPEC_PATH"
git show -s --format=%B <sha>
```

## Decide in one pass

Process all pending reviewers together. Your options are:

- Accept: keep the reviewed spec as-is.
- Revert: revert one or more review commits.
- Modify: keep the reviewer intent but make follow-up edits before acknowledging.

If you need changes, make them before the acknowledgement commit.

## Acknowledge the reviews

After the spec is in its final state, commit the changes (audit trail) and record the ack. `aigon spec-review ack` clears the pending flag for **all** open reviews on this spec — if you need partial acks, run it once per commit-sha instead:

```bash
git add "$SPEC_PATH"
git commit --allow-empty -m "spec-review-check: feature {{ARG1_SYNTAX}} — <decision summary>" -m "reviewed: <comma-separated reviewer ids>

Decision:
- <accept|revert|modify summary>

Notes:
- <important rationale>"

aigon spec-review ack feature {{ARG1_SYNTAX}} \
  --acked-by="${AIGON_AGENT_ID:-unknown}" \
  --notes="<short decision summary>" \
  --commit-sha="$(git rev-parse HEAD)"
```

If you reverted review commits, include that rationale in the acknowledgement commit body rather than creating a second ack commit.

## Report

Tell the user:

1. Which pending reviews you processed.
2. Whether you accepted, reverted, or modified the reviewed changes.
3. Any follow-up edits you made to the spec.
