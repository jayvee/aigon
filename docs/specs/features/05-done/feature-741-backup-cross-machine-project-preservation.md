---
aigon_id: F741
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
transitions:
  - { from: "inbox", to: "backlog", at: "2026-08-04T13:35:41.472Z", actor: "cli/feature-prioritise" }
---

# Feature: backup-cross-machine-project-preservation

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary

Make Vault safe to push from a machine that has only a subset of the projects
stored in the remote, and keep Git-tracked `.aigon` files under Git authority
during restore. This closes the two concrete gaps found while restoring Machine
B after F740.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ] As an operator moving between machines, pushing from a smaller machine does not erase recovery snapshots for projects that are not cloned there.
- [ ] As an operator pulling an older Vault snapshot after updating code, Git-tracked `.aigon` files remain at the checked-out Git version.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] Push refreshes each registered, locally present project's Vault directory but preserves Vault project directories not present locally.
- [ ] Restore planning excludes currently Git-tracked `.aigon` files because Vault will not mutate them.
- [ ] Restore preserves the current working-tree version of every Git-tracked `.aigon` file, including tracked deletions.
- [ ] New pushes omit Git-tracked `.aigon` files from the portable Vault scope.
- [ ] Focused regression tests cover an unavailable remote project and a newer Git-tracked file surviving an older snapshot restore.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm run test:iterate
node tests/unit/backup.test.js
node -c lib/backup.js
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach

- Preserve the remote `projects/` directory during a push, replacing only directories for registered repositories that exist locally.
- Derive tracked `.aigon` paths with `git ls-files`; remove them from backup copies and restore diffs.
- Overlay current tracked files onto the staged restore tree before its atomic swap, removing an incoming path when Git currently records it as deleted.
- Keep F740's archive, exact managed replacement, and schedule-off behavior unchanged.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- F740 backup-restore-integrity.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Vault project deletion/pruning commands.
- Cloning or registering projects automatically.
- Changes to lifecycle or SpecStore behavior.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- None.

## Related
<!-- Links to research topics, other features, or external docs -->
- Incident: Machine B had 5 registered repositories while the authoritative Vault contained 16 project snapshots.
- Prior work: F740 backup-restore-integrity.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
