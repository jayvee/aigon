<!-- description: Review feature spec <ID> - improve the spec itself before implementation -->
# aigon-feature-spec-review

Review the feature spec itself, not the code. Edit the spec in place using the shared rubric below, then commit the reviewed spec with a `spec-review:` commit.

**Your job: WRITE a review of this spec.** That means reading it, making targeted edits in place, and creating one `spec-review:` commit that records your findings. You are the reviewer. Do not check for or process anyone else's reviews — that is a separate downstream task (`feature-spec-review-check`) and is not what you are doing here.

If `git log` shows no prior `spec-review:` commits on this spec, that is expected — your review will be the first. Do **not** exit with "no pending reviews"; that would be the check workflow, not this one.

You are already inside the spec-review task for this feature.

- Do not run `aigon feature-spec-review {{ARG1_SYNTAX}}` again.
- Do not run `aigon feature-spec-review-check {{ARG1_SYNTAX}}` — that is a different command for a later stage, run by the feature author after reviewers have submitted. It is not your job here.
- Do not ask the shell to start the same command recursively.
- Use the resolved spec path below, edit that spec in place, then make the required `spec-review:` commit and run `aigon feature-spec-review-record {{ARG1_SYNTAX}}`.
- If you cannot complete the commit or record step, stop and report the blocker instead of making a generic commit.

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

1. Resolve `SPEC_PATH`.
2. Read the full spec carefully.
3. Make targeted edits in place.
4. Preserve author intent unless it is ambiguous, contradictory, or clearly under-specified.
5. Prefer tightening acceptance criteria, execution order, ownership, and edge cases over adding net-new scope.
6. Verify `AIGON_AGENT_ID` is set before committing.
7. Commit with the exact `spec-review: feature ...` format below.
8. Run `aigon feature-spec-review-record {{ARG1_SYNTAX}}`.
9. Do not create any other commit message format.

Before committing, confirm the reviewer identity is available:

```bash
test -n "${AIGON_AGENT_ID:-}" || { echo "AIGON_AGENT_ID is required for spec-review commits"; exit 1; }
```

## Commit format

Commit exactly once after your spec edits:

```bash
git add "$SPEC_PATH"
git commit -m "spec-review: feature {{ARG1_SYNTAX}} — <summary>" -m "Reviewer: ${AIGON_AGENT_ID}

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
aigon feature-spec-review-record {{ARG1_SYNTAX}}
```

## Forbidden

- Running `aigon feature-spec-review {{ARG1_SYNTAX}}` from inside this task
- Running `aigon feature-spec-review-check {{ARG1_SYNTAX}}` or `aigon feature-spec-review-check-record {{ARG1_SYNTAX}}` — that is the next stage, not this one
- Making a `spec-review-check:` commit (even `--allow-empty`) — that commit belongs to the check stage
- Making a non-`spec-review:` commit
- Ending the task before `feature-spec-review-record` succeeds

## Report to the user

Tell the user what you changed and why.

Then, as the last line of your reply, print the following **as a literal suggestion for the user to run next** — do not execute it yourself:

`{{CMD_PREFIX}}feature-spec-review-check {{ARG1_SYNTAX}}`
