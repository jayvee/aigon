---
description: Review every feature spec in a set together — coordinated spec review before implementation
argument-hint: "<slug> [--agent=<agent>] [--no-launch]"
---
# aigon-feature-set-spec-review

Review **all reviewable specs in a feature set** together. This is still **spec review**, not implementation: do not start features, do not modify non-spec files, and do not run target-repo build/test commands unless a spec explicitly requires read-only verification.

You are already inside the set-wide spec review task for set `{{SET_SLUG}}`.

- Do not run `aigon feature-set-spec-review {{SET_SLUG}}` again.
- Do not run `aigon feature-spec-revise` on any member until authors are ready — that is a later per-feature step.
- Edit member specs **in place** only.
- Create **one `spec-review:` commit per affected feature spec** (never one combined multi-spec commit).
- After each edited spec, start and record that member's spec-review cycle with `aigon feature-spec-review <id|slug> --no-launch`, then `aigon feature-spec-review-record <id|slug>`.

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
aigon feature-spec-review <ID|slug> --no-launch
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
