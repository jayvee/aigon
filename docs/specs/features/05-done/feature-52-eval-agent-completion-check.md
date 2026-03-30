# Feature: eval-agent-completion-check

## Summary

Add a pre-flight check to `feature-eval` that warns the user if one or more agents haven't submitted their work yet. Currently running `/afe` before all agents finish produces confusing or incomplete evaluation results. The check should show which agents are still working and offer to open their terminal sessions via `worktree-open`.

## User Stories

- [ ] As a developer, I want `feature-eval` to warn me if agents haven't submitted, so I don't accidentally evaluate incomplete work
- [ ] As a developer, I want a quick way to reconnect to unfinished agents from the eval warning

## Acceptance Criteria

- [ ] `feature-eval` reads log statuses for all known agents before starting evaluation
- [ ] If any agent has status other than `submitted`, a warning is printed listing unfinished agents and their statuses
- [ ] The warning suggests `aigon terminal-focus <ID> <agent>` for each unfinished agent
- [ ] User can bypass the warning with `--force` flag to evaluate anyway
- [ ] If all agents have submitted, eval proceeds without any extra output
- [ ] Works for both feature and research evaluations

## Validation

```bash
node --check lib/commands/shared.js
```

## Technical Approach

In the `feature-eval` command handler, before starting the evaluation flow, scan log files for the feature ID and check frontmatter status. If any agent's status is not `submitted`, print a warning table and exit (unless `--force`).

## Dependencies

- Existing log file status parsing (`parseFrontMatterStatus`)

## Out of Scope

- Auto-waiting for agents to finish
- Integration with AIGON server for live status

## Related

- feature-radar-auto-trigger-eval (complementary — radar auto-triggers when ready, this guards against premature manual triggers)
