# Feature: feature-eval CLI Launch

## Summary

`feature-eval` currently only works inside an agent session. When run from the CLI it prints a warning and does nothing. `feature-implement` already has this pattern — it detects whether it's inside an agent session and if not, auto-launches the agent CLI. `feature-eval` should do the same.

## User Stories

- [ ] As a developer, I want to run `aigon feature-eval 44` from the terminal and have it automatically launch an agent to perform the evaluation, without needing to open a separate agent session

## Acceptance Criteria

- [ ] `aigon feature-eval <ID>` from a plain shell auto-launches the configured agent (default: cc) to perform the evaluation
- [ ] `aigon feature-eval <ID> --agent=gg` launches a specific agent
- [ ] When already inside an agent session, behaviour is unchanged (shows instructions as today)
- [ ] The agent warning is removed or replaced with a "launching agent..." message when auto-launching
- [ ] `conduct`'s auto-eval phase benefits automatically — it can trigger a real evaluation end-to-end

## Technical Approach

Reuse the same pattern as `feature-implement`:

1. Call `detectActiveAgentSession()` at the start of the feature-eval handler
2. If not inside an agent session, build the agent command using `getAgentCliConfig` + `evalPrompt` (or `implementPrompt` with a feature-eval instruction)
3. `spawnSync` the agent CLI with the eval prompt
4. If inside an agent session, show instructions as today

The eval prompt sent to the agent should be `/aigon:feature-eval <ID>` (same as what a user would type manually).
