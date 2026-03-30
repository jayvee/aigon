# Feature: remove-redundant-spec-move-commits

## Summary

Now that the workflow engine is the source of truth for feature and research lifecycle state, the git commits that accompany every spec folder move are redundant noise. Every `feature-start`, `feature-eval`, `feature-close`, `feature-pause`, `research-start`, `research-close`, etc. creates a commit like `"chore: start feature 42 - move spec to in-progress"`. These commits clutter git history with mechanical state transitions that are already recorded in the engine's event log. Remove them — except for the one case where the commit is structurally required (`feature-start` must commit before worktree creation).

## User Stories

- [ ] As an aigon user, my git history contains meaningful commits (code changes, docs), not mechanical spec-move noise
- [ ] As an aigon user, `git log --oneline` shows my work, not 5 "chore: move spec" commits per feature lifecycle
- [ ] As an aigon user, `feature-start` still works correctly with worktrees (the one commit that matters is preserved)

## Acceptance Criteria

- [ ] `feature-start` still commits the spec move to in-progress before creating the worktree (required for worktree branch inheritance)
- [ ] `feature-eval` does NOT create a git commit for the spec move
- [ ] `feature-close` does NOT create a git commit for the spec move (the merge commit is sufficient)
- [ ] `feature-pause` / `feature-resume` do NOT create git commits for spec moves
- [ ] `research-start` still commits if worktrees are used (same reason as feature-start)
- [ ] `research-eval` / `research-close` do NOT create git commits for spec moves
- [ ] `feature-prioritise` / `research-prioritise` still commit (moves from inbox to backlog — this is a user-initiated action worth recording, and worktrees may branch soon after)
- [ ] The engine event log remains the authoritative record of all transitions
- [ ] Spec files still move between folders (the projection is preserved) — just no git commit for most moves
- [ ] `feature-close` final commit (moving spec to done + log files) is preserved — this is meaningful, not noise
- [ ] All workflows (solo, fleet, drive) still work correctly

## Validation

```bash
npm test
# Manual: run a full feature lifecycle and verify git log has no intermediate spec-move commits
```

## Technical Approach

Audit every `runGit('git commit -m "chore:.*move"')` call in `lib/entity.js` and `lib/commands/feature.js`:

| Transition | Current commit | Keep? | Reason |
|-----------|---------------|-------|--------|
| `feature-prioritise` | Yes | **Yes** | User action, worktrees may follow |
| `feature-start` | Yes | **Yes** | Worktree branches from HEAD |
| `feature-eval` | Yes | **No** | Engine records this |
| `feature-close` (spec to done) | Yes | **Yes** | Final cleanup, meaningful |
| `feature-close` (intermediate) | Yes | **No** | Engine records this |
| `feature-pause` | Yes | **No** | Engine records this |
| `feature-resume` | Yes | **No** | Engine records this |
| `research-prioritise` | Yes | **Yes** | Same as feature |
| `research-start` | Yes | **Yes** | Same as feature |
| `research-eval` | Yes | **No** | Engine records this |
| `research-close` (spec to done) | Yes | **Yes** | Final cleanup |

The change: remove the `runGit('git add ...')` + `runGit('git commit ...')` calls for the "No" rows. The spec file still moves on disk — it just isn't committed until the next meaningful commit (agent work, close, etc.).

## Dependencies

- depends_on: feature-175-research-workflow-engine-migration (research must be on engine first)

## Out of Scope

- Changing how spec files move between folders (projection behaviour preserved)
- Changing the engine event log format
- Removing the final close commit (that one stays)

## Open Questions

- Should `feature-start` commit include only the spec move, or should it also stage any other pending changes? (Currently it only stages specs/)

## Related

- Feature 171 (full cutover) — engine became sole authority
- Feature 175 (research migration) — research on engine
- `lib/entity.js` — contains most of the `runGit` commit calls
