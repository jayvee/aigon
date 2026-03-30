# Feature: remove-redundant-spec-move-commits

## Summary

Now that the workflow engine is the source of truth for feature and research lifecycle state, most git commits that accompany spec folder moves are redundant noise. These commits clutter history with mechanical projections that are already recorded in workflow state. Remove the commit noise where it is not structurally required, while preserving the small number of commits that still carry real workflow value.

This is worthwhile only if it is done as simplification, not policy sprawl. The target is fewer special cases, fewer `git add`/`git commit` calls scattered through workflow commands, and a cleaner distinction between:
- transitions recorded by the engine
- meaningful user-visible commits that are still needed for worktree inheritance or final close-up state

## User Stories

- [ ] As an aigon user, my git history contains meaningful commits (code changes, docs), not mechanical spec-move noise
- [ ] As an aigon user, `git log --oneline` shows my work, not 5 "chore: move spec" commits per feature lifecycle
- [ ] As an aigon user, `feature-start` still works correctly with worktrees (the one commit that matters is preserved)
- [ ] As an aigon maintainer, I can reason about one explicit policy for workflow projection commits instead of ad hoc per-command exceptions

## Acceptance Criteria

- [ ] `feature-start` still commits the spec move to in-progress before creating the worktree (required for worktree branch inheritance)
- [ ] `feature-eval` does NOT create a git commit for the spec move
- [ ] `feature-close` keeps exactly one final meaningful commit for the completed workflow output (`spec` in done, logs/eval artifacts as applicable); no extra intermediate "move to evaluation" or other transition-only commit remains
- [ ] `feature-pause` / `feature-resume` do NOT create git commits for spec moves
- [ ] Inbox-name `feature-pause` / `feature-resume` also follow the same reduced-noise commit policy, with an explicit keep-or-remove decision in the implementation
- [ ] `research-start` does NOT keep a spec-move commit unless the implementation still proves a structural need equivalent to feature worktree inheritance
- [ ] `research-eval` does NOT create a git commit for the spec move
- [ ] `research-close` keeps at most one final meaningful close commit; if the final research close commit is retained, the spec explains why it remains valuable
- [ ] `feature-prioritise` / `research-prioritise` still commit (moves from inbox to backlog — this is a user-initiated action worth recording, and worktrees may branch soon after)
- [ ] The engine event log remains the authoritative record of all transitions
- [ ] Spec files still move between folders (the projection is preserved) — just no git commit for most moves
- [ ] All real spec-move commit sites are covered by the implementation plan, including:
  - feature start
  - feature eval
  - feature pause/resume
  - inbox pause/resume
  - research start
  - shared prioritise
  - shared final close
- [ ] All workflows (solo, fleet, drive, research) still work correctly
- [ ] Net code deletion or consolidation is visible in the implementation; this should reduce scattered commit logic, not just rename commit messages

## Validation

```bash
npm test
node aigon-cli.js feature-start <ID> <agent>
node aigon-cli.js feature-eval <ID>
node aigon-cli.js feature-pause <ID>
node aigon-cli.js feature-resume <ID>
node aigon-cli.js research-start <ID>
node aigon-cli.js research-eval <ID>
node aigon-cli.js research-close <ID>
```

Manual validation:

- Run a full feature lifecycle and verify `git log --oneline` has no intermediate projection-only commit beyond the preserved start/final close policy.
- Verify a worktree created after `feature-start` still sees the spec in `03-in-progress`.
- Verify feature pause/resume still moves the spec correctly without leaving extra mechanical commits.
- Verify research start/eval/close still move the spec correctly with the reduced commit policy.
- Verify prioritise still creates a commit for both feature and research.

## Technical Approach

Audit every current workflow-related commit site before changing policy:

- `lib/commands/feature.js`
- `lib/commands/research.js`
- `lib/entity.js`

| Transition | Current commit | Keep? | Reason |
|-----------|---------------|-------|--------|
| `feature-prioritise` | Yes | **Yes** | User action, worktrees may follow |
| `feature-start` | Yes | **Yes** | Worktree branches from HEAD |
| `feature-eval` | Yes | **No** | Engine records this |
| `feature-close` final commit | Yes | **Yes** | Final workflow output, meaningful |
| `feature-pause` | Yes | **No** | Engine records this |
| `feature-resume` | Yes | **No** | Engine records this |
| `feature-pause` / `feature-resume` for inbox-name flows | Yes | **Decide explicitly** | Keep only if there is a clear product reason; otherwise remove for consistency |
| `research-prioritise` | Yes | **Yes** | Same as feature |
| `research-start` | Yes | **Probably No** | No current worktree inheritance requirement is evident |
| `research-eval` | Yes | **No** | Engine records this |
| `research-close` final commit | Yes | **Decide explicitly** | Keep only if the final done-state commit is still considered meaningful |

Implementation shape:

1. Remove projection-only commits first.
   Delete the `git add` + `git commit` calls for eval and engine pause/resume transitions, and likely for research-start.

2. Decide and document the retained final-close policy.
   `feature-close` currently keeps a meaningful final commit. Research close should either follow that same end-of-work rule or drop the extra close commit; the implementation should choose one policy and apply it consistently.

3. Normalize odd edge cases instead of preserving them accidentally.
   Inbox pause/resume flows currently create commits outside the engine path. Either keep them for a clear user-facing reason or remove them for consistency, but do not leave them unreviewed.

4. Prefer one shared helper if multiple command paths still need the same commit/no-commit decision.
   This feature should reduce scattered commit policy, not spread it to more branches.

5. Verify deferred projection changes still get committed at the next meaningful write.
   If eval or pause/resume no longer commit immediately, confirm the eventual meaningful commit includes the moved spec and any related artifacts.

## Dependencies

- depends_on: feature-175-research-workflow-engine-migration (research must be on engine first)

## Out of Scope

- Changing how spec files move between folders (projection behaviour preserved)
- Changing the engine event log format
- Re-architecting workflow-core
- Rewriting worktree inheritance behavior

## Open Questions

- Should inbox name-based pause/resume commits be removed for consistency, or kept because they represent explicit user filing actions outside engine-managed lifecycle?
- Should research close keep a final close commit to match feature-close, or should research be stricter about “no projection-only commits”?
- Should `feature-start` commit include only the spec move, or should it also stage any other pending changes? (Currently it only stages specs/)

## Related

- Feature 171 (full cutover) — engine became sole authority
- Feature 175 (research migration) — research on engine
- `lib/entity.js` — shared prioritise/final-close commit behavior
- `lib/commands/feature.js` — feature-specific start/eval/pause/resume commit behavior
- `lib/commands/research.js` — research start commit behavior
