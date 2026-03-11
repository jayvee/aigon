# Feature: Autonomous Submit

## Summary

When running in autonomous mode (`--autonomous --auto-submit`), agents currently stop at the manual testing gate in the feature-implement skill and wait for human confirmation before submitting. This defeats the purpose of autonomous mode. The agent should auto-submit after implementation + validation passes, without requiring human intervention.

## User Stories

- [ ] As a developer, I want `aigon conduct 44 cc gg` to run fully end-to-end without me having to attach to tmux sessions and manually submit each agent

## Acceptance Criteria

- [ ] When an agent is spawned with `--auto-submit`, it skips the manual testing gate (Step 4 of feature-implement) and submits automatically after validation passes
- [ ] The agent still runs `aigon agent-status waiting` to update the log front matter before submitting
- [ ] The agent still writes a manual testing checklist in its log for the evaluator to review
- [ ] Agents spawned without `--auto-submit` continue to stop and wait at the testing gate as today
- [ ] `aigon conduct` benefits automatically — all agents submit without human intervention

## Technical Approach

The feature-implement skill needs to detect whether it was invoked with `--auto-submit` (via the Ralph loop). When detected:

- Skip the "STOP and WAIT for user confirmation" step
- Automatically run `/aigon:feature-submit` instead of waiting
- Still write the testing checklist to the log (for evaluator reference) but don't block on it

Detection options:
1. The Ralph loop sets an environment variable (`AIGON_AUTO_SUBMIT=1`) before spawning the agent
2. The skill reads a marker file in the worktree (e.g. `.aigon/auto-submit`)
3. The `aigon feature-implement` command (inside the agent) writes a flag the skill can read

Option 2 (marker file) is simplest — `feature-setup` or the Ralph loop creates `.aigon/auto-submit` when `--auto-submit` is passed, and the skill checks for it.

## Out of Scope

- Skipping validation (npm run build still runs)
- Auto-merging the winning implementation
