---
complexity: medium
set: detail-fidelity
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-12T04:40:57.560Z", actor: "cli/feature-prioritise" }
---

# Feature: postclose-detail-panel-fallbacks

## Summary

After a feature closes, two feature-detail panels go empty because they assume a live
worktree / session and degrade to empty (not to a stored/merged source):

1. **Code changes** — `handleCommits` (`lib/dashboard-routes/commits.js`) calls
   `findFeatureWorktree()`, which still finds the leftover worktree **directory** at
   `~/.aigon/worktrees/<repo>/feature-<id>-...`. But on close the worktree's `.git` linkfile
   is removed (it is no longer a git repo; `git worktree list` does not list it). git fails
   silently inside that orphaned dir → empty commits, and it **never falls back** to
   `collectFromMerged()`, which would find `Merge feature <id>` and the feature commits on
   `main`. Confirmed on feature 09: main has `Merge feature 09` + `feat:`/`fix(review):`
   commits, but the panel shows nothing.

2. **Agent log** — the log file exists with real content
   (`docs/specs/features/logs/feature-09-dark-mode-log.md`, includes the cx review notes),
   but its filename has **no agent code** (`feature-09-dark-mode-log.md`, not `...-cc-...`).
   `collectEntityAgentLogs()` (`lib/dashboard-status-collector.js:1680`) keys it as `solo`,
   while the Agents tab renders per-agent cards keyed to `cc` — so the log is on disk but
   attached to the wrong key and never shown. The worktree's log subdir is also gone.

## User Stories
- [ ] As an operator viewing a closed feature, the Code changes panel shows the commits
      that were merged for that feature.
- [ ] As an operator viewing a closed feature, the Agent log panel shows the implementation
      log that was written, even though the worktree is gone and the filename lacks an
      agent code.

## Acceptance Criteria
- [ ] Code changes: when the worktree directory exists but is not a valid git repo (orphaned
      after close), `handleCommits` falls through to `collectFromMerged()` instead of
      returning empty. A closed+merged feature shows its merge-range commits.
- [ ] `findFeatureWorktree()` (or its caller) treats a dir without a working `.git` as
      "no live worktree", so the merged-commit path is taken.
- [ ] Agent log: a log file whose filename omits the agent code is still surfaced for the
      feature — either keyed to the implementer/solo appropriately, or shown in a
      feature-level log section so content is never silently dropped.
- [ ] Both panels verified against a closed feature (e.g. re-run brewboard feature 09 flow)
      via Playwright snapshot per repo testing discipline.

## Technical Approach
- **Code changes**: in `lib/dashboard-routes/commits.js`, guard `collectFromWorktree()` with
  a validity check (e.g. `git -C <wt> rev-parse --git-dir` succeeds) — on failure, fall
  through to `collectFromMerged(repoPath, entityId)`. Optionally have close clean up the
  orphaned worktree directory so it does not shadow the fallback at all (decide during
  planning; the read-side guard is the robust fix regardless).
- **Agent log**: in `collectEntityAgentLogs()` (`lib/dashboard-status-collector.js:1680`),
  reconcile the agent-code-less filename (`feature-<id>-<name>-log.md`) against the known
  implementer from the snapshot so it is keyed to the right agent (or surfaced at
  feature level). Confirm the per-agent card render in `detail-tabs.js renderAgents()`
  picks it up.
- Read-only discipline: panels read git/disk; they must not mutate state. (Worktree cleanup,
  if added, belongs in the close write-path, not the dashboard.)

## Dependencies
depends_on: none

## Out of Scope
- Reviewer surfacing in the Agents tab (covered by reviewer-surfacing-in-detail-view).
- Cost/stats correctness (covered by close-cost-telemetry-race).

## Open Questions
- Should close proactively remove the orphaned worktree directory, rely on the read-side
  fallback, or both? (Both is safest: clean producer + defensive reader.)
- For the agent log, is keying-to-implementer sufficient, or should there be a
  feature-level "log" section independent of agent cards so nothing is ever dropped?

## Related
- Set: detail-fidelity
- Sibling features: close-cost-telemetry-race (set_lead), reviewer-surfacing-in-detail-view
- Origin: brewboard feature 09 autonomous-run investigation (2026-06-12)
