---
complexity: medium
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
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
---

# Feature: sync visible spec file moves across git-branch storage clones

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
When git-branch storage is enabled, workflow events and leases converge through
the `aigon-state` branch, but the visible spec markdown files still move through
the target repo's normal git branch. If two machines start different features
without pulling each other's normal repo commits, snapshots can say a feature is
`implementing` while the local spec file still sits in `02-backlog`, producing
spec drift and confusing dashboard actions. Add a first-class cross-machine spec
file move sync so lifecycle folder moves recorded in workflow events are applied
locally after storage sync, without moving user-authored spec content out of the
target repo.

## User Stories
- [ ] As an operator using two dashboard machines, when machine B starts a
      feature, machine A sees the spec in `03-in-progress` after storage sync
      without manually pulling normal git commits first.
- [ ] As an operator, I can still review and edit specs as ordinary markdown
      files in my project repo; Aigon does not hide the canonical user-facing
      spec document on `aigon-state`.
- [ ] As an operator, if applying a remote spec move would overwrite local
      edits or collide with another file, Aigon refuses the move and surfaces a
      clear dashboard/doctor repair action instead of silently clobbering data.

## Acceptance Criteria
- [ ] Workflow events that move a feature/research spec between lifecycle
      folders include enough canonical metadata to reconstruct the visible move:
      entity type, entity id, from stage, to stage, basename, and event id.
- [ ] `aigon storage sync` and the dashboard storage poller apply pending
      visible spec moves after event sync when the destination is absent and the
      source file is cleanly identifiable.
- [ ] The move applier is idempotent: replaying the same event or syncing twice
      leaves the same filesystem state and does not create duplicate commits.
- [ ] The applier refuses unsafe cases: missing source with no matching
      destination, destination already exists with non-placeholder content,
      ambiguous duplicate specs, dirty local spec content, and paths outside
      `docs/specs/`.
- [ ] Unsafe cases surface as a read-model status with actionable copy in the
      dashboard and `aigon storage doctor --fix`/`aigon doctor --fix`, not as a
      raw "Spec drift" card with only generic reconcile text.
- [ ] Two-clone git-branch tests cover: machine A starts F1, machine B starts
      F2, each syncs storage, and both visible spec folders converge without
      normal git pull.
- [ ] The design keeps spec markdown files in the target repo's normal git
      branch. `aigon-state` stores workflow events, leases, and move intents,
      not the canonical user-authored spec file contents.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm test
node tests/integration/two-clone-git-branch-storage.test.js
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach
Do not move full spec files onto `aigon-state` as the canonical storage. Specs
are user-facing project documents and belong in the target repository so normal
review, editor tooling, and repo history keep working. Instead, use
`aigon-state` as the coordination channel for lifecycle move intents.

Extend the workflow event payloads emitted by start/eval/close/reset/pause
paths so the storage branch has durable, replayable visible-move metadata. Add a
small move applier in the spec-store sync path. After syncing events, it compares
the local visible spec layout with the event-derived expected layout and performs
only safe renames within `docs/specs/`. If the move cannot be proven safe, it
records a structured drift/blocked state for the dashboard and doctor.

Normal git commits for spec moves should still be created when Aigon owns the
local operation, so single-machine history remains useful. The new sync applier
is the cross-machine repair path for machines that received the workflow event
before the corresponding normal repo commit.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- Existing git-branch storage backend and lease sync.
- Existing spec reconciliation/read-model drift detection.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Storing complete spec markdown contents exclusively on `aigon-state`.
- Solving arbitrary normal-code branch divergence between machines.
- Auto-merging conflicting spec text edits.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- Should safe applied remote moves be committed automatically on the normal repo
  branch, or left as working-tree changes with a dashboard notice?
- Should dashboard storage sync trigger the move applier immediately or only
  after the storage poller confirms lease data is fresh?

## Related
<!-- Links to research topics, other features, or external docs -->
- Incident: brewboard storage lab showed F2 snapshot at `implementing` while
  host visible spec remained in `02-backlog`.
- Prior work: git-branch spec-store storage and lease coordination.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
