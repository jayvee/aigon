---
description: Review research spec <ID> - improve the research brief before execution (shortcut for research-spec-review)
argument-hint: "<ID|slug> [--agent=<agent-id>]"
---
# aigon-research-spec-review

Review the research topic spec itself, not the findings. Edit the spec in place using the shared rubric below, then commit the reviewed spec with a `spec-review:` commit.

**Your job: WRITE a review of this research spec.** That means reading it, making targeted edits in place, and creating one `spec-review:` commit that records your findings. You are the reviewer. Do not check for or process anyone else's reviews — that is a separate downstream task (`research-spec-revise`) and is not what you are doing here.

If `git log` shows no prior `spec-review:` commits on this spec, that is expected — your review will be the first. Do **not** exit with "no pending reviews"; that would be the check workflow, not this one.

You are already inside the spec-review task for this research topic.

- Do not run `aigon research-spec-review $1` again.
- Do not run `aigon research-spec-revise $1` — that is a different command for a later stage, run by the research author after reviewers have completed their review. It is not your job here.
- Do not ask the shell to start the same command recursively.
- Use the resolved spec path below, edit that spec in place, then make the required `spec-review:` commit and run `aigon research-spec-review-record $1`.
- If you cannot complete the commit or record step, stop and report the blocker instead of making a generic commit.

## Resolve the spec

```bash
SPEC_PATH=$(find docs/specs/research-topics -maxdepth 2 \( -name "research-$1-*.md" -o -name "research-$1.md" \) | head -1)
test -n "$SPEC_PATH" && echo "$SPEC_PATH"
```

If `SPEC_PATH` is empty, stop and report that the research spec could not be resolved.

Read the spec:

```bash
cat "$SPEC_PATH"
```

## Review rubric

## Spec Review Rubric

Review the spec against this checklist. Prefer small, targeted edits over broad rewrites.

### Specificity
- Replace vague language with concrete behavior, constraints, and outcomes.
- Name exact commands, files, states, and data shapes where they matter.

### Completeness
- Ensure the happy path, error path, and lifecycle edge cases are covered.
- Call out missing UX states, integration seams, or follow-up commits/tests the spec requires.

### Testability
- Acceptance criteria should be observable and falsifiable.
- Prefer criteria that can be checked with a command, visible UI state, or concrete artifact.

### Scope clarity
- Remove work that belongs in a follow-up feature.
- Flag hidden expansion of scope, especially cross-cutting work that was not signalled in the spec.

### Understandability
- Tighten structure so implementation order and ownership are obvious.
- Eliminate ambiguity about which module or layer should own the change.

### Consistency
- Align with existing Aigon patterns: centralized action rules, ctx usage, template source-of-truth, and workflow-core authority.
- Avoid introducing a second source of truth or frontend-only eligibility logic.

### Minimal-diff preference
- Edit in place.
- Keep valid author intent.
- Strengthen the spec without rewriting its voice unless the original wording is actively harmful or unclear.

### Frontmatter: complexity
- Verify `complexity:` matches the spec's actual scope + risk + judgment-load using the rubric (low / medium / high / very-high).
  - **low** config/doc/single-file; **medium** standard cross-cutting; **high** multi-file engine/event/dashboard; **very-high** architectural shifts.
- If the author over- or under-rated complexity, revise the value. Note the revision (old → new) in the review commit's Summary and give the reason in one line.
- **Remove any legacy `recommended_models:` YAML** (or per-agent model/effort keys) from frontmatter if present — specs must not embed model IDs; defaults come from the agent's complexity-defaults table at start time.
- Frontmatter edits ship in the same `spec-review:` commit as other edits.

## Review workflow

1. Resolve `SPEC_PATH`.
2. Read and edit `SPEC_PATH` directly.
3. Tighten the research questions, scope, evidence expectations, and output shape.
4. Keep edits targeted and in-place.
5. Clarify what a good findings document must contain without broadening the topic.
6. Verify or bootstrap `AIGON_AGENT_ID` before committing.
7. Commit with the exact `spec-review: research ...` format below.
8. Run `aigon research-spec-review-record $1`.
9. Do not create any other commit message format.

Before committing, confirm the reviewer identity is available. Dashboard/tmux launches
set `AIGON_AGENT_ID` before the agent starts; direct slash-command use inside an
already-running agent may need to derive it from the current agent process:

```bash
if [ -z "${AIGON_AGENT_ID:-}" ]; then
  AIGON_AGENT_ID=$(aigon agent-context --id-only 2>/dev/null || true)
  export AIGON_AGENT_ID
fi
test -n "${AIGON_AGENT_ID:-}" || { echo "AIGON_AGENT_ID is required for spec-review commits"; exit 1; }
```

## Commit format

```bash
git add "$SPEC_PATH"
git commit -m "spec-review: research $1 — <summary>" -m "Reviewer: ${AIGON_AGENT_ID}

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
aigon research-spec-review-record $1
```

## Forbidden

- Running `aigon research-spec-review $1` from inside this task
- Running `aigon research-spec-revise $1` or `aigon research-spec-revise-record $1` — that is the next stage, not this one
- Making a `spec-revise:` commit (even `--allow-empty`) — that commit belongs to the revise stage
- Making a non-`spec-review:` commit
- Ending the task before `research-spec-review-record` succeeds

## Report to the user

Tell the user what you changed and why.

Then, as the last line of your reply, print the following **as a literal suggestion for the user to run next** — do not execute it yourself:

`aigon-research-spec-revise $1`
