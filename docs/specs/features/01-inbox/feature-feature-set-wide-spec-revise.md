---
complexity: high
depends_on: feature-set-wide-spec-review
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: feature-set-wide-spec-revise

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Add a set-level spec revision flow so an author can process all pending `spec-review:` commits for every feature in a feature set in one coordinated pass. Feature 583 introduces set-wide spec review; this feature adds the matching author-side acknowledgement command and dashboard action, while preserving the existing per-feature `spec-revise:` commits and workflow events that make each member's review cycle independently auditable.

## User Stories
- [ ] As a feature-set author, I can ask one revision agent to inspect every pending review across the set instead of running `feature-spec-revise <id>` repeatedly.
- [ ] As a revision agent, I receive the ordered set membership, dependency context, pending review commits per member, and current spec contents in one prompt.
- [ ] As an author, I can make coordinated accept/revert/modify decisions across sibling specs when a review comment spans multiple features.
- [ ] As an operator, I still get one `spec-revise:` acknowledgement commit per affected feature so each member's audit trail and workflow state remain correct.
- [ ] As a dashboard user, I can start "Revise Set Specs" from the set card when any eligible member has pending spec reviews.

## Acceptance Criteria
- [ ] A new CLI command exists for set-level spec revision: `aigon feature-set-spec-revise <slug>`, and validates the set slug with `lib/feature-sets.js:isValidSetSlug`.
- [ ] The command resolves members using `getSetMembersSorted(slug)` so the revision prompt follows dependency/topological order, not arbitrary filesystem order.
- [ ] Active revision candidates are members that have a pending `spec-review:` commit and matching logged workflow state indicating review completion/submission. If the git commit exists but the workflow signal is missing, flag that member as inconsistent instead of silently treating it as ready.
- [ ] Done/closed members and members already in implementation or later are skipped from the active revision set. Do not hard-fail the whole set because some members are in progress or done; include skipped members in the prompt's context table with a skip reason.
- [ ] Pending reviews authored by the same agent selected to run set-wide revision are skipped. If a member's only pending reviews were authored by the selected revision agent, skip that member with an explicit "same-agent review" reason rather than letting an agent revise its own review.
- [ ] The command refuses to run only when the set has no eligible members with pending `spec-review:` commits newer than that member's latest `spec-revise:` or legacy `spec-review-check:` acknowledgement.
- [ ] Pending review detection reuses the existing per-feature semantics from `templates/generic/commands/feature-spec-revise.md`: inspect git history for each member spec path with `--follow`, find the latest acknowledgement, and collect newer `spec-review:` commits, then cross-check that review completion is represented in the workflow/read-model state.
- [ ] The revision launch prompt includes: set slug, ordered member table, dependency edges from `getSetDependencyEdges(slug)`, each member's lifecycle/stage, pending review commit summaries per member, and the full markdown body of each member spec.
- [ ] The revision prompt is explicit that this is author-side spec revision, not implementation or new review: do not start features, do not run target-repo build/test commands unless directly needed for read-only spec validation, and do not modify non-spec files.
- [ ] The revision agent may accept, revert, or modify reviewed spec changes across multiple members, but must create exactly one `spec-revise:` acknowledgement commit per eligible member that had pending reviews, even if the final decision for that member is accept-as-is. The acknowledgement commit is how future runs know those `spec-review:` commits were processed.
- [ ] Each acknowledged member's workflow state records spec-revision completion through the existing `feature-spec-revise-record` path or an equivalent shared helper; no set-level workflow event replaces the per-feature signal.
- [ ] The command does not eagerly move every set member into `spec_revision_in_progress`. It should record start/completion only for members with pending reviews, or use a narrowly scoped shared helper that preserves existing per-member action eligibility.
- [ ] The revision pass processes eligible members in dependency order using `getSetMembersSorted(slug)`. Commit and record acknowledgements in that same order so upstream spec decisions are settled before downstream specs.
- [ ] The dashboard set card exposes a server-owned valid action labeled "Revise Set Specs" when the set contains at least one eligible member with pending spec reviews. Add this to `buildSetValidActions` in `lib/feature-set-workflow-rules.js` by threading a pending-revision count into the `setState` object at the dashboard status producer; do not branch on member state in frontend code.
- [ ] The dashboard start flow selects one revision agent/model/effort triplet for the whole set revision, matching F583's single reviewer picker pattern. Defaults should be guided by the feature-set creator; use the first feature's creator/author as the set creator proxy unless F583 establishes a more explicit set creator field.
- [ ] Starting the action from the dashboard launches one revision session and surfaces it in session tracking with a name parseable by `lib/agent-sessions/names.js`. Use the existing session-name grammar unchanged: anchor the session to the first member with pending reviews, use the existing `spec-revise` role, and store the set slug/member list in session metadata.
- [ ] Tests cover command validation, member ordering, pending-review detection, prompt payload shape, per-member acknowledgement/record behavior, and dashboard valid-action exposure.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Build this as the author-side sibling of F583's `feature-set-spec-review` flow. The set is orchestration context; individual feature specs remain the workflow owners.
- Add the public command through the existing set command surface, keeping `lib/commands/set.js` thin. Put shared discovery/prompt/record helpers in a focused module if the implementation would otherwise make the dispatcher large.
- Reuse `lib/feature-sets.js` for slug validation, sorted members, and dependency edges. Do not rescan set members by filename or duplicate dependency sorting logic.
- Reuse the existing `feature-spec-revise` git-history contract for each member spec, then cross-check review completion through the workflow/read-model state so revision targets are both committed and logged. This is load-bearing because current author-side revision relies on per-file `git log --follow` discovery, while the set-level command should avoid acting on orphaned review commits that were never recorded.
- Filter pending reviews by selected revision agent before building the active set. The author-side revision pass should process reviews from other agents only; same-agent reviews stay pending for a different revision agent or the existing single-feature path.
- Prefer a set-level prompt template under `templates/generic/commands/` only if it remains target-repo neutral. The template must not mention package managers, frameworks, or language-specific validation commands.
- Keep commit granularity per member spec and process commits in dependency order. A single multi-file acknowledgement commit would break the current "latest ack for this spec path" model and make future per-feature review/revise cycles ambiguous.
- For dashboard support, extend the server-owned set action registry and API/action dispatch path. The frontend should render the action from `validActions` and pass the selected agent triplet; eligibility must be computed server-side.
- For session tracking, reuse the existing `spec-revise` role and anchor the session to the first pending member id. Store set metadata in the session sidecar so attach/peek/nudge and later observability can distinguish set-wide revision from normal single-feature revision.
- If F583 introduces shared set-review helpers, this feature should reuse or generalize them rather than creating parallel review and revise code paths.

## Dependencies
- F583 `feature-set-wide-spec-review`, because this feature is its author-side counterpart and should mirror its command/dashboard/session conventions.
- Existing per-feature spec review/revision workflow states.
- Existing `feature-spec-revise` prompt and `feature-spec-revise-record` command behavior.
- Existing feature-set membership and dependency ordering.

## Out of Scope
- Set-wide code review or code revision.
- Revising research-topic sets.
- A new set-level workflow engine or event log.
- Automatic implementation, autonomous sequencing, or feature start behavior.
- A rich set-review summary/report beyond what the revision prompt and per-feature commits record.

## Open Questions
- If a member has a pending `spec-review:` commit but no corresponding workflow/read-model review completion signal, should the command offer a `--repair` mode that records the missing review state, or should repair stay manual via existing doctor/workflow tools?
- If F583 later introduces an explicit set creator field, should this feature migrate from "first feature creator" defaulting to that field automatically?

## Related
- F583: `feature-set-wide-spec-review`
- Relevant modules: `lib/feature-sets.js`, `lib/commands/set.js`, `lib/commands/entity-commands.js`, `lib/feature-set-workflow-rules.js`, `lib/dashboard-status-collector.js`, `lib/agent-sessions/names.js`
- Relevant templates: `templates/generic/commands/feature-spec-revise.md`, F583's set-wide spec review template if one is added
