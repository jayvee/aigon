<!-- description: Revise every pending spec review across a feature set — coordinated author acknowledgement -->
# aigon-feature-set-spec-revise

You are the **author-side** revision agent. Process pending `spec-review:` commits across **all eligible specs in a feature set** together. This is still **spec revision**, not implementation: do not start features, do not modify non-spec files, and do not run target-repo build/test commands unless a spec explicitly requires read-only verification.

You are already inside the set-wide spec revision task for set `{{SET_SLUG}}`.

- Do not run `aigon feature-set-spec-revise {{SET_SLUG}}` again.
- Do not run `aigon feature-spec-review` or start new reviews — those are reviewer-side steps.
- Process members **in dependency order** (upstream before downstream).
- Create **one `spec-revise:` acknowledgement commit per eligible member** that had pending reviews, even when accepting as-is.

## Set context

**Set slug:** `{{SET_SLUG}}`

**All members (with revision status):**

{{SET_MEMBER_TABLE}}

**Intra-set dependency edges:**

{{SET_DEPENDENCY_EDGES}}

**Pending review commits per eligible member:**

{{SET_PENDING_REVIEWS}}

## Member specs (editable for accept/revert/modify decisions)

{{SET_MEMBER_SPECS}}

## Coordinated revision workflow

1. Read the member table, dependency edges, pending review summaries, and full spec bodies together.
2. For each **eligible** member in dependency order, inspect pending `spec-review:` commits (use `git log --follow` / `git show` on that member's spec path).
3. Decide per member: **accept**, **revert**, or **modify** the reviewed changes. Make any follow-up spec edits before acknowledging.
4. For **each** eligible member that had pending reviews, land exactly one acknowledgement commit, then record workflow state:

```bash
SPEC_PATH="<member spec path>"
RECORD_ARG="<member id or slug>"

git add "$SPEC_PATH"
git commit --allow-empty -m "spec-revise: feature $RECORD_ARG — <decision summary>" -m "reviewed: <comma-separated reviewer ids>

Decision:
- <accept|revert|modify summary>

Notes:
- <important rationale>"
aigon feature-spec-revise-record $RECORD_ARG
```

5. Repeat step 4 for every eligible member **in dependency order** before moving to downstream specs.
6. Do not move specs between lifecycle folders or start implementation.

**Per-member record targets (dependency order):**

{{SET_REVISE_TARGETS}}

## Forbidden

- Starting any feature (`feature-start`, `feature-do`, set autonomous commands, …)
- One combined acknowledgement commit touching multiple member spec files
- Non-`spec-revise:` commits for acknowledgement work
- Editing files outside `docs/specs/features/`
- Running `aigon feature-set-spec-revise {{SET_SLUG}}` recursively
- Revising reviews you authored yourself (those were filtered out before launch)

## Report to the user

Summarize decisions per member, list each `spec-revise:` acknowledgement commit, and note any members skipped (done, in-progress, inconsistent workflow, or same-agent reviews).
