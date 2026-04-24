<!-- description: Revise research spec after pending spec reviews — decide and acknowledge in one pass -->
# aigon-research-spec-revise

You are the author-side agent. Review all pending `spec-review:` commits on the research spec, decide what to keep, and land one acknowledgement commit.

## Resolve the spec

```bash
SPEC_PATH=$(find docs/specs/research-topics -maxdepth 2 \( -name "research-{{ARG1_SYNTAX}}-*.md" -o -name "research-{{ARG1_SYNTAX}}.md" \) | head -1)
test -n "$SPEC_PATH" && echo "$SPEC_PATH"
```

If `SPEC_PATH` is empty, stop and report that the research spec could not be resolved.

## Find pending review commits

```bash
LAST_ACK=$(git log --follow --format=%H -n 1 --grep='^spec-review-check:' --grep='^spec-revise:' -- "$SPEC_PATH")
echo "last_ack=${LAST_ACK:-none}"
git log --follow --format='%H %s' -- "$SPEC_PATH"
```

Pending reviews are commits whose subject starts with `spec-review:` and are newer than `LAST_ACK` if `LAST_ACK` exists.

For every pending review commit:

```bash
git show <sha> -- "$SPEC_PATH"
git show -s --format=%B <sha>
```

## Decide in one pass

Process all pending reviewers together. Accept, revert, or modify the reviewed changes, then leave the spec in its final state.

## Acknowledge with one commit

```bash
git add "$SPEC_PATH"
git commit --allow-empty -m "spec-revise: research {{ARG1_SYNTAX}} — <decision summary>" -m "reviewed: <comma-separated reviewer ids>

Decision:
- <accept|revert|modify summary>

Notes:
- <important rationale>"
aigon research-spec-revise-record {{ARG1_SYNTAX}}
```

## Report

Tell the user:

1. Which pending reviews you processed.
2. Whether you accepted, reverted, or modified the reviewed changes.
3. Any follow-up edits you made to the spec.
