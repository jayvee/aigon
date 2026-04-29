---
complexity: medium
---

# Feature: Fix review-to-revision handoff: worktree path resolution and auto-injection

## Summary

Three related bugs cause the review→revision handoff to fail when the reviewer agent is running inside a git worktree, and require the user to manually nudge the implementing agent after a code review. First, `aigon feature-code-revise` reads `process.cwd()` instead of the main repo path, so when run from a worktree it finds no workflow snapshot and exits with "No implementing agent found." Second, the skill path passed to non-slash-command-invocable agents (currently cx) is a relative path that only resolves correctly from the main repo — in the worktree it resolves to nothing. Third, the `feature-code-review` template ends with `aigon agent-status review-complete` and leaves the revision injection as a manual step, so in standard drive mode (no autonomous controller) the implementing agent just sits idle after review.

Found via F445 post-mortem: cx implemented in a worktree, cu reviewed in a separate session, and the user had to manually compose and send the revision prompt because none of the automatic machinery fired.

## User Stories

- [ ] As a user running a fleet review (cx implements, cu reviews), after the reviewer signals completion, the implementing agent should automatically receive the revision prompt — I should not have to manually send a tmux message.
- [ ] As a user or reviewer agent running `aigon feature-code-revise <ID>` from inside a worktree, the command should find the implementing agent and inject the prompt, not fail with "No implementing agent found."
- [ ] As a non-slash-command-invocable agent (cx) receiving a revision prompt, the skill file path in that prompt should resolve correctly from the worktree I am sitting in.

## Acceptance Criteria

- [ ] `aigon feature-code-revise <ID>` succeeds when run from a worktree (same or different feature's worktree), resolving snapshot and sessions from the main repo.
- [ ] `aigon feature-code-revise <ID>` run from the main repo continues to work as before.
- [ ] The skill path injected for a non-slash-command-invocable agent (cx) is an absolute path that resolves correctly from any working directory.
- [ ] The `feature-code-review` template Step 5 triggers the revision injection directly (via `aigon feature-code-revise`), so the implementing agent receives the prompt automatically when the reviewer finishes — no manual user step required.
- [ ] Existing tests pass. New unit test covers `feature-code-revise` invoked with a mock that simulates a worktree CWD (snapshot found only when main repo path is used).

## Validation

```bash
node --check lib/commands/feature.js
node --check lib/agent-prompt-resolver.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### RC-3: `feature-code-revise` path resolution

`lib/commands/feature.js` line 992 hardcodes `const repoPath = process.cwd()`. The fix is to wrap the `feature-code-revise` handler with `withActionDelegate` from `lib/action-scope.js` — the same pattern used by `feature-close` and others. `withActionDelegate` calls `buildActionContext(ctx.git)` which uses `git.getMainRepoPath()` (already in `lib/git.js`) to detect a worktree and auto-delegate to the main repo via `runDelegatedAigonCommand`. Additionally, add `'feature-code-revise': { scope: 'main-only' }` to `ACTION_SCOPES` in `lib/action-scope.js` so the delegation fires. (It currently falls through to the `main-only` default but is not explicitly listed, which is confusing and should be fixed regardless.)

The `withActionDelegate` delegation approach is preferred over manually calling `git.getMainRepoPath()` inside the handler, because it re-runs the command in the correct CWD, ensuring all downstream callers (tmux session lookup, status writes, etc.) also use the right path.

### RC-2: Absolute skill path for non-slash-command-invocable agents

`lib/agent-prompt-resolver.js` `buildAgentSkillPath()` returns a relative path. `buildReviewCheckFeedbackPrompt` should accept an optional `repoPath` parameter and pass it to `buildAgentSkillPath`, which should prefix it to return an absolute path: `path.join(repoPath, dir, prefix + verbName, skillFileName)`. Callers that already know the main repo path (`feature-autonomous.js`, `feature-code-revise`) pass it through; callers that don't (fallback) resolve it via `git.getMainRepoPath()`.

### RC-1: Auto-inject revision prompt from review template

`templates/generic/commands/feature-code-review.md` Step 5 currently ends with:
```bash
aigon agent-status review-complete
```

Replace with:
```bash
aigon feature-code-revise <featureId>
```

`feature-code-revise` already calls `wf.recordCodeRevisionStarted` internally, which covers the state transition previously handled by `agent-status review-complete`. The reviewing agent (cu/cc/gg) runs this from its worktree — with RC-3 in place this delegates to the main repo automatically, finds the implementing session, builds the correct absolute skill path (RC-2), and injects the prompt.

Note: the autonomous controller (`lib/feature-autonomous.js`) already calls `feature-code-revise` logic directly and is unaffected by the template change.

### Key files

- `lib/commands/feature.js` — wrap `feature-code-revise` handler with `withActionDelegate`
- `lib/action-scope.js` — add explicit `feature-code-revise: { scope: 'main-only' }` entry
- `lib/agent-prompt-resolver.js` — `buildReviewCheckFeedbackPrompt` and `buildAgentSkillPath` accept optional `repoPath`, return absolute path
- `templates/generic/commands/feature-code-review.md` — Step 5 calls `aigon feature-code-revise` not `aigon agent-status review-complete`
- `tests/integration/feature-code-revise.test.js` (new) — worktree delegation test

## Dependencies

- None

## Out of Scope

- Changing how slash-command-invocable agents (cc, gg) receive revision prompts — their path already works correctly via Claude Code's git-worktree-aware command discovery.
- Autonomous controller (`lib/feature-autonomous.js`) — it already handles the review→revision injection in `--stop-after close` mode. This fix is for standard drive mode only.
- Research review flow — separate command path, not affected by these bugs.

## Open Questions

- **Is `recordCodeRevisionStarted` the correct state transition for when the reviewer calls `feature-code-revise`?** Currently `agent-status review-complete` and `feature-code-revise` are separate steps. Collapsing them means the reviewer both marks the review done and starts the revision in one call. Verify that `recordCodeRevisionStarted` in `lib/workflow.js` sets `reviewCompletedAt` as well as `revisionStartedAt`, or add that to the call so the autonomous controller's `isCodeRevisionInProgress` check continues to work.
- **Should `feature-code-revise` also write `agent-status review-complete` for the reviewing agent's status file, or is `recordCodeRevisionStarted` sufficient for the dashboard?** Check `lib/dashboard-status-collector.js` — specifically whether the `review-complete` status on the reviewing agent's row is set from the workflow snapshot (via `recordCodeRevisionStarted`) or from the agent status file (requiring an explicit `writeAgentStatus` call for the review agent).

## Related

- Set: standalone
