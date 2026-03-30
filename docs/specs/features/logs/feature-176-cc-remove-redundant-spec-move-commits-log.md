# Implementation Log: Feature 176 - remove-redundant-spec-move-commits
Agent: cc

## Plan

Audit all spec-move commit sites across `lib/commands/feature.js`, `lib/commands/research.js`, and `lib/entity.js`. Remove commits for transitions where the workflow engine is the authoritative record. Preserve commits that have structural requirements (worktree inheritance) or represent meaningful user-visible workflow output.

## Progress

- Identified 13 spec-move commit sites across 3 files
- Removed 8 commit sites (feature-pause x3, feature-resume x3, feature-eval x1, research-start x1)
- Preserved 5 commit sites (feature-start, entityPrioritise, feature-close, entityCloseFinalize, feature-now)
- Verified research-eval already had no spec-move commit
- All 17 test suites pass (0 failures)
- Net result: -33 lines (35 deleted, 2 added)

## Decisions

### Commit policy by transition

| Transition | Commit | Reason |
|-----------|--------|--------|
| feature-prioritise | **Keep** | User action, worktrees may branch soon after |
| feature-start | **Keep** | Worktree branches from HEAD — spec must be committed |
| feature-eval | **Remove** | Engine records this; eval file creation is picked up by close commit |
| feature-pause (all 3 paths) | **Remove** | Engine records this; uncommitted spec move picked up by next meaningful commit |
| feature-resume (all 3 paths) | **Remove** | Engine records this; uncommitted spec move picked up by next meaningful commit |
| feature-close | **Keep** | Final workflow output — meaningful end-of-lifecycle commit |
| feature-now | **Keep** | Equivalent to prioritise+start; creates spec + log atomically |
| research-prioritise | **Keep** | Same policy as feature-prioritise |
| research-start | **Remove** | No worktree inheritance requirement (research uses findings files, not git worktrees) |
| research-eval | **Already clean** | Uses `wf.requestResearchEvalSync` only, no git calls |
| research-close | **Keep** | Final workflow output via entityCloseFinalize — consistent with feature-close |

### Inbox pause/resume decision

Removed commits for consistency. Inbox pause/resume are lightweight filing actions outside the engine — the spec move still happens on disk, but doesn't need a dedicated commit. The user's next meaningful action (prioritise, start, or close) will capture the state.
