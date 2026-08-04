---
aigon_id: F740
complexity: high
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
  - { from: "inbox", to: "backlog", at: "2026-08-04T13:06:11.685Z", actor: "cli/feature-prioritise" }
---

# Feature: backup-restore-integrity

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary

Make Aigon Vault restore safe enough for routine machine recovery. Before a pull
changes project state it must preserve the current managed state, then replace
the managed backup scope exactly instead of overlaying it. Machine-local runtime
and backup configuration remain untouched, and a successful pull disables the
automatic backup schedule so restarting the dashboard cannot push immediately.

## User Stories
- [ ] As an operator restoring a second machine, I can inspect the source and exact file changes before any local state changes.
- [ ] As an operator with local-only state, I have an automatic recovery archive before it is replaced.
- [ ] As an operator running the dashboard after a restore, I cannot accidentally push the restored/mixed state back to the vault.
- [ ] As an operator, I can use repository Git/SpecStore for ongoing cross-machine state rather than treating Vault as a merge engine.

## Acceptance Criteria
- [ ] `backup pull --dry-run` performs no project/settings mutation and reports per-project add, change, and removal counts plus the remote SHA.
- [ ] A real pull creates a timestamped pre-restore archive before replacing any project state.
- [ ] Restore is an exact mirror for the filtered managed `.aigon` scope, pruning stale managed files absent from the snapshot while preserving `PROJECT_EXCLUDES`, excluded files, logs, sessions, locks, caches, server state, and other explicitly machine-local paths.
- [ ] Global `backup` configuration, `repos`, `serverPort`, and `sync` remain machine-local and are never imported from another machine.
- [ ] A successful pull sets the local backup schedule to `off`; dashboard startup therefore cannot immediately push restored or mixed state.
- [ ] Focused regression coverage proves dry-run immutability, stale-file pruning, excluded-path preservation, archive creation, and schedule shutdown.

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

- Keep `lib/backup.js` as the domain owner and preserve the existing CLI aliases.
- Separate a read-only restore plan from application so `--dry-run` and pull describe the same adds, changes, and removals.
- Before applying, copy each target project's filtered managed `.aigon` scope into a timestamped archive under `~/.aigon/restore-archives/`.
- Build a replacement `.aigon` tree from the incoming managed state plus local excluded/runtime entries, then swap it into place. This prunes stale managed files without touching sessions, locks, cache, server state, excluded files, or logs.
- Strip the global `backup` key from backed-up settings so schedules and remote configuration remain local.
- After a successful pull, set the local backup schedule to `off` and report that it must be re-enabled deliberately.
- Keep canonical feature/research cross-machine collaboration in the existing `git-branch` SpecStore. Vault backup remains disaster recovery for filtered `.aigon` state and settings, not a merge engine.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- Existing vault Git remote and helper-repository primitives in `lib/sync-core.js`.
- Existing SpecStore `git-branch` backend remains the recommended live cross-machine state transport.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Automatic conversion of every registered repository to `git-branch` storage.
- Merging divergent workflow event streams inside Vault backup.
- Backing up code or `docs/specs/**`; those continue to use normal Git.
- Restoring sessions, locks, caches, server processes, or other machine-local runtime state.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- None.

## Related
<!-- Links to research topics, other features, or external docs -->
- Incident: Machine A to Machine B restore on 2026-07-26 left stale managed workflow files and the dashboard startup pushed the mixed state back to the vault.
- Prior work: F712 unified the Vault/backup engine; SpecStore features 609-613 provide the separate git-branch state authority.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
