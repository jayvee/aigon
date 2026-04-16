# Feature: entity-repair-command

## Summary

Add a user-facing repair command:

```bash
aigon repair <entity-type> <id>
```

This command reconciles broken entity state without resetting or discarding work. It is for cases where the visible spec location, workflow engine snapshot, agent status files, sessions, branches, worktrees, logs, or review state have drifted out of sync. The command should repair the minimum safe amount of state needed to make the entity coherent again, and it must explain exactly what it changed.

The command should use entity language, not subsystem language. Users want to repair a feature or research topic, not “repair workflow state”.

## Why This Exists

We hit a real failure mode:

- a feature was already merged
- the spec file was already in `05-done/`
- the workflow engine snapshot still said `implementing`
- stale agent/session state still existed
- the dashboard kept showing the item as active

Today this requires direct engine calls or manual cleanup across multiple folders. That is too fragile and too internal. Aigon already has:

- `feature-close` for normal completion
- `feature-reset` for destructive restart
- `sessions-close` for runtime cleanup

It is missing the non-destructive middle path:

- `repair` for safe reconciliation

## User Stories

- [ ] As a user, when a feature or research item looks “stuck” in the dashboard even though the work is already done, I want one repair command that reconciles the state safely so I do not have to inspect internal engine files.
- [ ] As a user, when an entity has stale sessions, stale state files, or mismatched spec/workflow stage, I want Aigon to detect the inconsistency and apply the minimum safe fix instead of forcing a destructive reset.
- [ ] As a user, before Aigon changes anything, I want a dry-run style explanation of what is wrong and what it plans to repair so I can trust the command.
- [ ] As a maintainer, I want the repair logic centralized and explicit so agents stop inventing ad hoc manual fixes for drifted entity state.

## Command Shape

Primary command:

```bash
aigon repair <entity-type> <id>
```

Examples:

```bash
aigon repair feature 173
aigon repair research 12
```

Optional follow-up flags for future-proofing:

```bash
aigon repair feature 173 --dry-run
aigon repair feature 173 --verbose
```

The initial implementation only needs `--dry-run` in addition to the base command.

### v1 scope

- This feature ships for `feature` and `research` only.
- `feedback` is out of scope for v1 and should not be implied by examples or acceptance criteria.
- If the command is later generalized to feedback, it should be a follow-up expansion with explicit lifecycle rules for feedback state.

## Acceptance Criteria

### Command UX

- [ ] `aigon repair <entity-type> <id>` is available from the CLI
- [ ] Supported entity types are at least `feature` and `research`
- [ ] If the entity type or ID is missing, the command prints clear usage text
- [ ] If the entity does not exist, the command exits with a clear error and makes no changes
- [ ] `aigon repair <entity-type> <id> --dry-run` prints detected inconsistencies and the planned repairs without mutating anything

### Detection

For features and research, the command inspects all relevant layers of state:

- [ ] visible spec file location under `docs/specs/`
- [ ] workflow engine state under `.aigon/workflows/...`
- [ ] per-agent runtime status files under `.aigon/state/`
- [ ] known worktrees and branches
- [ ] tmux/runtime session references where relevant
- [ ] review/eval/log placement where relevant

The command must detect at least these drift cases:

- [ ] spec file is already in `05-done/` but workflow lifecycle is not `done`
- [ ] workflow lifecycle is `done` but stale per-agent state files remain
- [ ] workflow lifecycle is `done` but stale local branches/worktree references remain
- [ ] workflow lifecycle references an in-progress spec path that no longer exists, while the done-spec path already exists
- [ ] entity appears active only because of stale runtime/session state

### Repair behavior

The command applies the minimum safe fix for each detected issue:

- [ ] if the entity is clearly complete and the workflow engine is behind, the command reconciles the workflow engine to the correct closed/done state
- [ ] if stale per-agent state files exist for a completed entity, the command removes them
- [ ] if stale sessions exist for a completed entity, the command closes them using the existing session cleanup path
- [ ] if stale local branches/worktrees exist for a completed entity, the command removes them using existing cleanup helpers
- [ ] if the entity is already coherent, the command prints `No repair needed` and exits cleanly

### Safety rules

- [ ] `repair` must not move a spec backwards in lifecycle
- [ ] `repair` must not discard unmerged work silently
- [ ] `repair` must not create a merge commit
- [ ] `repair` must not behave like `reset`
- [ ] when ambiguity exists, the command stops and prints why instead of guessing

Examples of ambiguity that must stop rather than auto-repair:

- [ ] spec says `done` but branch still exists with unmerged commits and workflow is not done
- [ ] multiple plausible sources of truth disagree and there is no clearly dominant safe reconciliation
- [ ] the branch is dirty or contains unmerged work and the repair would need to remove the branch/worktree

### Repair policy

Use these rules for the common repair cases:

- [ ] `done` spec + active workflow + clean branch/worktree + stale runtime/session artifacts => safe auto-repair
- [ ] `done` spec + active workflow + clean branch/worktree + no stale runtime/session artifacts => reconcile workflow to done and exit cleanly
- [ ] `done` spec + active workflow + dirty branch or unmerged commits => stop and explain the conflict
- [ ] active sessions only, but workflow is already `done` => close sessions, then report repaired
- [ ] active runtime/session artifacts without a corresponding active workflow or spec drift => remove stale metadata only if the entity is otherwise clearly complete
- [ ] if the command would delete a worktree or branch, require an explicit confirmation unless the implementation adds a dedicated `--yes` flag later

### Output

- [ ] the command prints a short diagnosis section before applying fixes
- [ ] the command prints each repair action it performed
- [ ] the final output states whether the entity was repaired, unchanged, or could not be safely repaired
- [ ] if the command refuses to act because of ambiguity or dirty work, it prints the specific reason and leaves state unchanged
- [ ] if the command performs destructive cleanup such as removing a stale branch/worktree, it says so explicitly in the summary

### Dashboard impact

- [ ] after repairing a drifted completed feature, the dashboard no longer shows it as in-progress
- [ ] after repairing stale agent/session state, the Sessions and board/dashboard views no longer show the entity as active solely due to stale runtime artifacts

## Validation

```bash
node -c aigon-cli.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/commands/setup.js
npm test
```

Feature-specific validation:

```bash
# Create or reuse a fixture repo state where:
# - spec is in 05-done
# - workflow snapshot says implementing
# - stale .aigon/state file exists
# Then verify:
aigon repair feature 173 --dry-run
aigon repair feature 173
```

## Technical Approach

### 1. Add a new top-level command family entry

Implement `repair` as a first-class CLI command, not as a hidden doctor flag. The command should be discoverable alongside `close`, `reset`, and `sessions-close`.

Suggested handler placement:

- command parsing in a command module, likely `lib/commands/feature.js` for first implementation if it ships for features first
- then extract shared entity repair helpers into a dedicated module if research support is added in the same feature

Preferred longer-term module:

- `lib/entity-repair.js`

This module should own:

- inspection
- drift categorization
- repair planning
- execution

### 2. Build a repair planner

Do not mutate state inline while discovering issues. First compute a repair plan:

- inspect spec location
- inspect workflow snapshot/events
- inspect `.aigon/state/*`
- inspect branches/worktrees
- inspect sessions/review state

Then classify each issue into:

- safe auto-repair
- no-op
- ambiguous / requires manual intervention

This plan object should be printable for `--dry-run`.

### 3. Reuse existing authorities, do not duplicate logic

Where possible, repairs should flow through existing authoritative paths:

- use workflow-core close transitions for “should be done” reconciliation
- use `sessions-close` / shared session cleanup helpers for session teardown
- use `feature-cleanup` style helpers for branch/worktree cleanup
- remove stale `.aigon/state` files only when the authoritative lifecycle already proves they are stale

Avoid directly editing snapshots unless there is no existing safe engine path. Prefer appending the missing event through workflow-core.

### 4. Define source-of-truth precedence

For features and research, precedence should be explicit:

1. workflow event log / workflow engine lifecycle
2. spec file location as visible projection
3. runtime state files and sessions as non-authoritative metadata

However, for drift repair, a special safe reconciliation rule is needed:

- if a feature has already been merged and the done spec exists, but the workflow engine is clearly missing the close transition, the repair command may append the missing close event via workflow-core and then clean stale runtime metadata

This should be treated as a recognized drift-repair case, not a generic override.

### 5. Ship feature support first, but design for entity support

The command shape should be `aigon repair <entity> <id>` from day one, even if implementation order is:

1. `feature`
2. `research`
3. `feedback` or future entity types

That keeps the user model stable.

### 6. Tests

Add focused tests for:

- no-op repair
- done spec + implementing workflow snapshot drift
- stale `.aigon/state` file cleanup after done
- stale branch/worktree cleanup after done
- ambiguous case refusal
- dry-run output

## Dependencies

- Existing workflow-core engine close transitions in `lib/workflow-core/engine.js`
- Existing cleanup helpers in feature command flow (`sessions-close`, `feature-cleanup`, `feature-reset`)
- Dashboard read-side behavior in `lib/dashboard-status-collector.js` and `lib/workflow-read-model.js`

## Out of Scope

- [ ] Bulk “repair every broken thing in the repo” mode
- [ ] Automatically repairing arbitrary git history divergence
- [ ] Reconstructing lost implementation work from deleted branches or worktrees
- [ ] Introducing a dashboard UI for repair actions
- [ ] Fixing unrelated session-toolbar UX bugs outside the repair command itself

## Open Questions

- [ ] Should `repair` live under its own top-level command (`aigon repair ...`) or be aliased from `doctor` as well?
- [ ] Should the first version support `research` immediately, or ship `feature` first and add `research` in a follow-up?
- [ ] Should successful repair write a small note to the entity log/closeout for auditability?
- [ ] Should the command offer an interactive confirmation by default when it plans to delete stale runtime/session artifacts?

## Related

- Research:
  - none yet
- Related commands:
  - `aigon feature-close`
  - `aigon feature-reset`
  - `aigon feature-cleanup`
  - `aigon sessions-close`
  - `aigon doctor`
