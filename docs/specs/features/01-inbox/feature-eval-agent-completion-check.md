# Feature: eval-agent-completion-check

## Summary
Add a pre-flight check to `feature-eval` that reads each agent's log file status before starting evaluation. If any agent hasn't submitted, warn the user and offer the `worktree-open` command to reconnect. Support `--force` to skip the check.

## User Stories
- [x] As a developer running `aigon feature-eval 40`, I want to be warned if any Fleet agent hasn't submitted their work yet, so I don't evaluate incomplete implementations
- [x] As a developer with a stale tmux session, I want to be offered the exact command to reconnect to the incomplete agent's worktree

## Acceptance Criteria
- [x] In Fleet mode, `feature-eval` reads each agent's log file and checks `status` front-matter
- [x] If any agent status is not `submitted`, print a warning showing agent, current status, and the `worktree-open` command
- [x] If all agents are submitted, proceed silently (no extra output)
- [x] `--force` flag skips the completion check and proceeds regardless
- [x] In Drive mode (single worktree), same check applies for the single agent
- [x] If no log files exist, skip the check (backwards compatible)

## Validation
```bash
node -c aigon-cli.js
```

## Technical Approach
- Insert the check after worktree detection (line ~6267) and before bias detection (line ~6270)
- Reuse existing `parseFrontMatterStatus()` function (line 7118)
- Read log files from `docs/specs/features/logs/` matching `feature-{num}-{agent}-*-log.md`
- The check runs in Fleet and Drive modes
- `--force` flag added alongside existing `--allow-same-model-judge`

## Dependencies
- Existing `parseFrontMatterStatus()` function
- Existing log file convention with YAML front-matter `status: submitted|implementing|waiting`

## Out of Scope
- Blocking eval entirely (always allow proceeding)
- Auto-opening worktrees (just suggest the command)
- Changes to how agents submit

## Related
- `aigon agent-status` command (sets front-matter status)
- `aigon feature-submit` command (triggers submission)
- `aigon worktree-open` command (reconnects to worktrees)
