# Feature: multiuser-4-team-mode-sync

## Summary

Add a `teamMode` config toggle to `aigon.config.json`. When enabled: state commits are automatically pushed to main for team visibility, `feature-start`/`research-start` enforce assignment locking (block if another user is already assigned, using git push rejection as the distributed lock), and an `aigon sync` command provides a convenient pull/push workflow. This is the capstone of the multiuser series — all prior features work in solo mode; this feature adds the multi-user coordination layer. Applies to all entity types (features, research, feedback).

## Sequence

This is **feature 4 of 5** in the `multiuser-` series:
1. `multiuser-migration-framework` — versioned migration infrastructure
2. `multiuser-state-consolidation` — single `state.json` per entity
3. `multiuser-auto-assignee` — assignee field on all entities
4. `multiuser-committed-state` — state committed to git as sibling files
5. `multiuser-team-mode-sync` ← this feature

## User Stories

- [ ] As a team member, I want to see what my teammates are working on by pulling their committed state
- [ ] As a team member, I want to be blocked from starting a feature that someone else is already working on
- [ ] As a team member, if I race another person to start the same feature, I want git's push rejection to resolve the race cleanly
- [ ] As a user, I want `aigon sync` to handle the commit/pull/push dance for me
- [ ] As a team member, I want state pushed to main so everyone's dashboard shows current board state

## Acceptance Criteria

- [ ] `teamMode: true` config option in `aigon.config.json` (default: `false`)
- [ ] When `teamMode` enabled: after state auto-commits (from `multiuser-committed-state`), Aigon pushes to the remote's main branch
- [ ] When `teamMode` enabled: `feature-start`/`research-start` check the remote assignee — if assigned to a different `user.email`, hard block with message: "Feature N is assigned to {name}. Use `--force` to override."
- [ ] Race condition handling: if two users both start the same entity, second push fails (non-fast-forward). On pull, Aigon detects the existing assignee and reports the conflict
- [ ] `aigon sync` command: commit any pending state changes, `git pull --rebase`, `git push`. Pre-pull stash of uncommitted changes. Post-pull dashboard refresh notification
- [ ] `feature-close`/`feature-reset` do NOT clear assignee (historical attribution) but the entity moving to `05-done` signals it's no longer active
- [ ] All entity types supported: features, research, feedback
- [ ] Works with any git remote (GitHub, GitLab, Bitbucket, bare repo) — no platform-specific API required for core functionality
- [ ] `aigon board` shows remote state after sync (other users' assigned entities visible)

## Validation

```bash
npm test
```

## Technical Approach

- Config: add `teamMode` boolean to `lib/config.js` project config schema, default `false`
- Push logic: after the auto-commit from `multiuser-committed-state`, if `teamMode`, run `git push origin main` (or configured default branch). Handle push rejection with pull + retry
- Assignment lock: before engine transition on `feature-start`/`research-start`, `git fetch origin`, read the remote's `.state.json` for the target entity, check `assignee.email` against `getGitUser().email`. If different and non-empty, block. `--force` flag bypasses
- Main branch state updates: when working on a feature branch, the state commit goes to main. Mechanics: stash WIP, checkout main, commit state, push, checkout feature branch, pop stash. Or use `git worktree` for main to avoid switching branches
- `aigon sync`: wrapper around `git stash && git pull --rebase && git push && git stash pop`. Surface errors clearly
- Platform independence: all operations are pure git (`fetch`, `push`, `pull`). No GitHub/GitLab API calls. Platform-specific enhancements (PR creation, notifications) are future Pro features

## Dependencies

- depends_on: multiuser-committed-state

## Out of Scope

- Platform-specific integrations (PR creation, webhooks, notifications) — future Pro features
- Multi-user dashboard with avatars and team views — future Pro feature
- Cross-user analytics — future Pro feature
- Concurrent work on the same entity by multiple users (explicitly excluded by design)
- Real-time collaboration — this is async via git
- Reassignment commands — future enhancement

## Open Questions

- None — design settled during R30 evaluation

## Related

- Research: #30 multi-user-workflow-state-sync
