<!-- description: Review every feature spec in a set together — coordinated spec review before implementation -->
# aigon-feature-set-spec-review

Review **all reviewable specs in a feature set** together. This is still **spec review**, not implementation: do not start features, do not modify non-spec files, and do not run target-repo build/test commands unless a spec explicitly requires read-only verification.

You are already inside the set-wide spec review task for set `{{SET_SLUG}}`.

- Do not run `aigon feature-set-spec-review {{SET_SLUG}}` again.
- Do not run `aigon feature-spec-revise` on any member until authors are ready — that is a later per-feature step.
- Edit member specs **in place** only.
- Create **one `spec-review:` commit per affected feature spec** (never one combined multi-spec commit).
- After each edited spec, run `aigon feature-spec-review-record <id|slug>` for that member only.

## Set context

**Set slug:** `{{SET_SLUG}}`

**Ordered members (dependency / topological order):**

{{SET_MEMBER_TABLE}}

**Intra-set dependency edges:**

{{SET_DEPENDENCY_EDGES}}

## Member specs (editable)

Only the specs below are in the active review set. Done or in-progress members are omitted from editing but may appear in the table above for dependency context.

{{SET_MEMBER_SPECS}}

## Review rubric

{{SPEC_REVIEW_RUBRIC}}

## Coordinated review workflow

1. Read every member spec and the dependency table together. Look for duplicated scope, wrong dependency order, inconsistent acceptance criteria, and downstream assumptions upstream specs do not promise.
2. Make targeted edits in place across one or more member specs.
3. For **each** spec you change, commit separately:

```bash
if [ -z "${AIGON_AGENT_ID:-}" ]; then
  AIGON_AGENT_ID=$(aigon agent-context --id-only 2>/dev/null || true)
  export AIGON_AGENT_ID
fi
test -n "${AIGON_AGENT_ID:-}" || { echo "AIGON_AGENT_ID is required for spec-review commits"; exit 1; }

git add "<SPEC_PATH>"
git commit -m "spec-review: feature <ID|slug> — <summary>" -m "Reviewer: ${AIGON_AGENT_ID}

Summary:
- <high-level summary>

Strengths:
- <what was already strong>

Gaps:
- <what you tightened or clarified, including cross-feature gaps>

Risky decisions:
- <scope or architectural risks, or 'None'>

Suggested edits:
- <notable edits you made>"
aigon feature-spec-review-record <ID|slug>
```

4. Repeat step 3 for every member spec you edited. Skip `feature-spec-review-record` for specs you did not change.
5. Do not move specs between lifecycle folders or start implementation.

**Per-member record targets after edits:**

{{SET_REVIEW_TARGETS}}

## Forbidden

- Starting any feature (`feature-start`, `feature-do`, set autonomous commands, …)
- One commit touching multiple member spec files
- Non-`spec-review:` commits for review work
- Editing files outside `docs/specs/features/`
- Running `aigon feature-set-spec-review {{SET_SLUG}}` recursively

## Report to the user

Summarize cross-feature findings and list each member spec you changed. Tell the operator they can run per-feature `feature-spec-revise <id>` when ready to acknowledge reviews.
