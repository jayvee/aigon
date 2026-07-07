# Implementation Log: Feature 637 - dashboard-poll-async-liveness-spawns
Agent: solo

Partial perf pass: (1) `collectPendingSpecReviewsFromGit` caches expensive `git log --follow` scans per `(repoPath, specPath, entityType, entityId)` keyed on repo HEAD sha, with `clearSpecReviewGitCache` test hook; (2) `runTmux` applies a default 5s `spawnSync` timeout (`SIGKILL`) so wedged `capture-pane`/`has-session` calls cannot freeze the poll/sweep event loop indefinitely. Integration test locks cache hit/miss/invalidation behaviour.

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-07

### Fixes Applied
- None — implementation was clean for the code that shipped

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:subsystem — Acceptance criteria largely unmet: no event-loop-lag probe (≤250ms contiguous target), no `/api/health` p99 measurement script, no deep-equal `/api/status` parity regression test, `detectDefaultBranch` still uncached per-feature, inbox/backlog/paused rows still spawn sync `git`/`tmux` during enrichment, and supervisor cold-start sweep gating/async spawns not addressed. The branch delivers two targeted mitigations from the diagnostic section but not the spec's primary deliverables.
- ESCALATE:architectural — Remaining poll-path work (per-repo-per-poll memoisation, precondition gating, async bounded-concurrency spawns per Technical Approach §1–2) is the bulk of the feature and was not started.

### Notes
- The two shipped changes are sound: HEAD-keyed pending-review cache correctly invalidates on new commits (test-covered); `runTmux` timeout degrades to "session not alive" / null capture, matching existing caller contracts.
- `DEFAULT_TMUX_TIMEOUT_MS = 5000` is reasonable for query/control tmux ops; agent launch paths that need longer should pass an explicit `timeout` override.
- Recommend profiling post-merge to quantify remaining sync-spawn share before/async work.
