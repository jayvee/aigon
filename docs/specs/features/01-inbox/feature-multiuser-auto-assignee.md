# Feature: multiuser-auto-assignee

## Summary

Always write an `assignee` field into `state.json` when an entity is started or created. The assignee is derived from `git config user.name` and `git config user.email` — no new configuration needed. This applies to all entity types (features, research, feedback) in both solo and team mode, maintaining a single code path. `aigon board` annotates all entities with their assignee, and a `--mine` filter shows only entities assigned to the current git user. This is useful immediately in solo mode (attribution, stats) and becomes essential when team mode is enabled.

## Sequence

This is **feature 2 of 5** in the `multiuser-` series:
1. `multiuser-migration-framework` — versioned migration infrastructure
2. `multiuser-state-consolidation` — single `state.json` per entity
3. `multiuser-auto-assignee` ← this feature
4. `multiuser-committed-state` — relocates state to git-tracked sibling files
5. `multiuser-team-mode-sync` — push/pull sync with assignment locking

## User Stories

- [ ] As a user, I want to see who is assigned to each feature/research/feedback on the board so I know who owns what
- [ ] As a solo user, I want my name recorded against my work so stats and history are attributed
- [ ] As a user, I want `aigon board --mine` to filter to just my entities so I can focus on my work

## Acceptance Criteria

- [ ] New `getGitUser()` function in `lib/git.js` returning `{ name, email }` from `git config`
- [ ] `feature-start` writes `assignee: { name, email, at }` into `state.json`
- [ ] `research-start` writes `assignee` into `state.json`
- [ ] `feedback-create` writes `assignee` into `state.json`
- [ ] Assignee is written unconditionally — no `teamMode` gate, no toggle
- [ ] `aigon board` shows assignee annotation on all entities (e.g., `feature-42 [John]`)
- [ ] `aigon board --mine` filters to entities where `assignee.email` matches current `git config user.email`
- [ ] Dashboard cards show assignee name/initials
- [ ] `feature-close` and `feature-reset` do NOT clear assignee — it's historical attribution, not an active lock
- [ ] Existing entities without an assignee field display normally (no error, just no annotation)

## Validation

```bash
node --check lib/git.js
npm test
```

## Technical Approach

- `getGitUser()`: shell out to `git config user.name` and `git config user.email`, cache for the process lifetime
- On `feature-start`/`research-start`: after engine transition to "implementing"/"researching", write `assignee` field into `state.json`
- On `feedback-create`: write `assignee` at creation time (feedback doesn't have a "start" step)
- Board rendering: read `assignee` from state, format as `[Name]` suffix on entity labels
- `--mine` filter: compare `assignee.email` against `getGitUser().email`
- No migration needed — existing entities simply lack the `assignee` field, which is treated as unassigned

## Dependencies

- depends_on: multiuser-state-consolidation

## Out of Scope

- Assignment locking (preventing others from starting an assigned entity) — that's `multiuser-team-mode-sync`
- Reassignment commands (`aigon feature-assign <id> <user>`) — future enhancement
- Team member discovery or user management

## Open Questions

- None — design settled during R30 evaluation

## Related

- Research: #30 multi-user-workflow-state-sync
