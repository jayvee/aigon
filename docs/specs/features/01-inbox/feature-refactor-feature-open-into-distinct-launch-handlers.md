# Feature: refactor feature-open into distinct launch handlers

## Summary

The `/api/feature-open` handler in `lib/dashboard-server.js` is a single ~130-line function that handles five fundamentally different operations (implement, review, eval, attach, send-keys) through shared mutable variables and early-return branches. This has caused bugs where review/eval sessions launched in the main repo instead of the worktree — a defect that went undetected for weeks because smarter agents compensated by navigating to the worktree from prompt context, while Codex committed directly to main. Refactor into distinct, self-contained launch functions with explicit parameter resolution so each operation's "where to run" and "what to run" are answered in one place.

## User Stories

- [ ] As a user launching a review from the dashboard, I expect the agent to always run in the correct worktree, regardless of which agent I pick
- [ ] As a developer reading the dashboard server code, I can understand each launch operation independently without tracing shared variables through branching logic
- [ ] As a developer adding a new launch mode (e.g., a future "debug" mode), I can add a new handler without risk of breaking existing modes

## Acceptance Criteria

- [ ] `/api/feature-open` dispatches to distinct functions: `launchImplementation()`, `launchReview()`, `launchEval()`, `attachSession()`, `restartAgent()`
- [ ] Each function receives an explicit params object (repoPath, worktreePath, featureId, agentId, desc) — no shared mutable state
- [ ] `worktreePath` resolution happens once in the dispatcher, is passed explicitly to each handler, and is never re-derived or assumed
- [ ] Review and eval handlers always use worktreePath when it exists (never absRepo)
- [ ] `buildAgentCommand` receives the resolved worktreePath as `path` — the `cd` prefix and tmux cwd always agree
- [ ] All existing dashboard actions (Start, Review, Eval, Attach, feature-open from pipeline drag) continue to work
- [ ] Manifest event recording (feature-review, feature-eval) is handled within the relevant handler, not as a bolt-on
- [ ] No net increase in line count (refactor, not addition)

## Validation

```bash
node --check lib/dashboard-server.js
npm test
```

## Technical Approach

### Current problems

1. **God handler**: one `if/else` chain handles implement, review, eval, attach, send-keys with shared variables (`worktreePath`, `sessionAction`, `mode`, `tmuxInfo`) that mean different things per branch
2. **Two competing cwd mechanisms**: `createDetachedTmuxSession(cwd)` and `buildAgentCommand`'s embedded `cd ${path}` can disagree — the tmux session starts in one directory while the command navigates to another
3. **Implicit contracts**: reviews "worked" because Claude/Gemini inferred the right directory from the prompt, not because the code was correct. Codex didn't, exposing the latent bug.

### Proposed structure

```
/api/feature-open handler
  ├── parse & validate payload (featureId, agentId, repoPath, mode)
  ├── resolve worktree path (one place, explicit)
  ├── build context object { absRepo, worktreePath, featureId, agentId, desc, isResearch }
  └── dispatch on mode:
       ├── 'implement' → launchImplementation(ctx)
       ├── 'review'    → launchReview(ctx)
       ├── 'eval'      → launchEval(ctx)
       └── default      → attachOrRestart(ctx)
```

Each handler:
- Receives the full context, never re-derives paths
- Builds its own session name and agent command
- Records its own manifest event
- Returns `{ ok, message, sessionName }` — dispatcher sends the HTTP response

### Key rules

- `worktreePath` is always the worktree if one exists, `absRepo` otherwise — resolved once
- `buildAgentCommand` always receives the same path used for `createDetachedTmuxSession` — no disagreement
- No handler reads variables set by another handler's branch

## Dependencies

- None (pure refactor of existing code)

## Out of Scope

- Refactoring `buildAgentCommand` itself (separate concern, separate feature)
- Changing how worktrees are created or discovered
- Adding new launch modes

## Open Questions

- Should `attachOrRestart` be split further into `attachSession()` and `sendKeys()`? (Probably yes, but could be phase 2)

## Related

- Bug: review agent committed to main because handler used `absRepo` instead of worktree (fixed in 794215fa)
- `lib/worktree.js:buildAgentCommand` — the `cd` prefix mechanism (line 129)
- `lib/worktree.js:createDetachedTmuxSession` — tmux session cwd
