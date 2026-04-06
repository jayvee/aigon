# Feature: refactor-feature-do-help-ux

## Summary

Running `aigon feature-do` with no arguments shows a confusing agent-context warning followed by usage text. The warning says "this command is meant to run inside an AI agent session" but then the usage text shows `--agent=<id>` which actually launches an agent from the shell (no agent session needed). Users are left confused about whether they can run the command from a plain terminal or not.

## User Stories

- [ ] As a user running `aigon feature-do` with no args, I see clear usage help without a misleading warning
- [ ] As a user in a plain terminal, I understand that `--agent` launches an agent and `--iterate` runs the Autopilot loop — both work without an existing agent session
- [ ] As a user inside an agent session, I understand that running without flags shows instructions for the agent to follow

## Acceptance Criteria

- [ ] `aigon feature-do` (no args, no agent session) shows usage text without the agent-context warning
- [ ] `aigon feature-do <ID>` (no agent session) still shows the warning with clear guidance
- [ ] Usage text clearly explains the three invocation modes: (1) from agent session (instructions mode), (2) `--agent` from shell (launch mode), (3) `--iterate` from shell (Autopilot mode)
- [ ] `printAgentContextWarning` only fires when an ID is provided but no `--agent` or `--iterate` flag is set

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

1. Move the `printAgentContextWarning` call to after the usage/ID check — don't warn when no ID is provided
2. Restructure the usage text to clearly show three invocation patterns:
   - Inside agent: `/aigon:feature-do <ID>` (instructions mode)
   - From shell: `aigon feature-do <ID> --agent=cc` (launch mode)
   - Autopilot: `aigon feature-do <ID> --iterate` (Autopilot mode)
3. Consider suppressing the warning entirely when `--agent` is passed (the user clearly intends to launch)

## Dependencies

- Feature #37 (modes and terminology) — uses new flag names

## Out of Scope

- Changing behavior of other commands that use `printAgentContextWarning`
- Refactoring the overall feature-do command structure

## Open Questions

- Should the warning be removed entirely when no ID is provided, or replaced with a simpler "missing ID" error?

## Related

- Feature #37: Modes and terminology rename
