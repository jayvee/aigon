---
complexity: high
---

# Feature: feature-set-wide-spec-review

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Add a set-level spec review flow so one reviewer can evaluate every feature spec in a feature set with the full dependency chain and shared product context in view. Today `feature-spec-review <id>` reviews one feature at a time, which misses cross-feature gaps such as duplicated scope, wrong dependency order, inconsistent acceptance criteria, or a downstream feature assuming behavior the upstream feature does not promise. This feature should introduce a first-class command and dashboard action for reviewing all specs in a `set: <slug>` together while preserving the existing per-feature review/revise workflow signals.

## User Stories
- [ ] As a user designing a multi-feature set, I can ask one reviewer to inspect the whole set before implementation starts.
- [ ] As a reviewer, I receive the ordered list of set members, their dependencies, current stages, and the full text of every member spec in one prompt/context.
- [ ] As a reviewer, I can make coordinated edits across multiple member specs and commit them as spec-review work.
- [ ] As the feature author/operator, I can still use the existing per-feature spec-revise path to accept, modify, or reject the review edits.
- [ ] As a dashboard user, I can start set-wide spec review from the set card instead of manually launching one review per feature.

## Acceptance Criteria
- [ ] A new CLI command exists for set-level spec review, tentatively `aigon set-spec-review <slug> [reviewer-agent]`, and validates the set slug with `lib/feature-sets.js:isValidSetSlug`.
- [ ] The command resolves members using `getSetMembersSorted(slug)` so the reviewer sees dependency/topological order, not arbitrary filesystem order.
- [ ] The command refuses to run when the set has no members, when all members are closed/done, or when any member cannot be resolved to a feature spec path.
- [ ] The review launch prompt includes: set slug, ordered member table, dependency edges, each member's current lifecycle/stage, and the full markdown body of each member spec.
- [ ] The reviewer prompt is explicit that this is still spec review, not implementation: do not start features, do not run target-repo build/test commands unless the spec itself requires read-only verification, and do not modify non-spec files.
- [ ] The reviewer may edit one or more member specs in place and must create `spec-review:` commits for the affected feature specs using existing commit semantics, so downstream `feature-spec-revise <id>` can discover and process the changes per feature.
- [ ] Each affected feature's workflow state records spec-review completion through the existing `feature-spec-review-record` path or an equivalent shared helper; no parallel sidecar-only review status is introduced.
- [ ] The dashboard set card exposes a server-owned valid action for set-wide spec review when the set contains at least one non-done member in a reviewable state.
- [ ] Starting the action from the dashboard launches one reviewer session and surfaces it in session tracking with a role that is parseable by `lib/agent-sessions/names.js`.
- [ ] Tests cover command validation, member ordering, prompt payload shape, multi-spec commit/record behavior, and dashboard valid-action exposure.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Add a set-scoped command module path alongside existing set commands rather than duplicating feature command internals. `lib/commands/set.js` should remain the public dispatcher, but shared review launch/record helpers should live outside the dispatcher if the implementation becomes large.
- Reuse `lib/feature-sets.js` for set discovery and ordering. Do not rescan or sort by filename in the new command.
- Reuse the existing spec-review workflow model where possible:
  - member features stay the workflow owners;
  - `spec_review_in_progress` / `spec_review_complete` remain per-feature states;
  - `feature-spec-revise <id>` remains the author-side acknowledgement path.
- Add a set-level prompt template under `templates/generic/commands/` only if it can stay target-repo neutral. The template must not mention language-specific validation commands or package managers.
- For dashboard support, extend the server-owned set action registry (`lib/feature-set-workflow-rules.js`) and action dispatch path instead of adding frontend-only branching.
- For session tracking, either extend `VALID_TMUX_ROLES` with a precise role such as `set-spec-review` or model the launch as one session with role `spec-review` plus set metadata. Pick the option that preserves attach/peek/nudge behavior with the least special casing.
- Keep the MVP focused on review context and workflow correctness. A later feature can add richer "set review summary" reporting if needed.

## Dependencies
- Existing feature-set membership (`set:` frontmatter) and sorted member discovery.
- Existing feature spec-review/revise engine states and templates.
- Existing agent session sidecar/role parsing.

## Out of Scope
- Set-wide code review after implementation.
- Set-wide automatic implementation or autonomous sequencing changes.
- A new set-level workflow engine or event log.
- Automatic rewriting of dependencies beyond reviewer-authored spec edits.
- Research-topic set review.

## Open Questions
- Should `set-spec-review` mark every non-done member as `spec_review_in_progress` before the reviewer starts, or only mark members whose specs the reviewer actually edits?
- Should one reviewer commit be allowed to touch multiple feature spec files, or should the reviewer create one `spec-review:` commit per affected feature to preserve current `feature-spec-revise <id>` discovery semantics?
- Should the dashboard action allow choosing the reviewer agent independently from set-autonomous review-agent defaults?
- Should the command include done/closed members as read-only context, exclude them entirely, or include only their titles/dependency role?
- What should happen if one member is already in `spec_review_in_progress` by another reviewer?
- Is the right command name `set-spec-review`, `feature-set-spec-review`, or an extension of `feature-spec-review --set <slug>`?

## Related
- Prior set work: `feature-set-4-failure-pause-resume`, `set-autonomous-start`, `set-prioritise`
- Relevant modules: `lib/feature-sets.js`, `lib/commands/set.js`, `lib/commands/entity-commands.js`, `lib/feature-set-workflow-rules.js`, `lib/agent-sessions/names.js`
