# Feature: remove feature-submit and enforce feature-do submission

## Summary

`feature-submit` is currently in a broken half-state: it still appears in prompt docs, command metadata, and agent-facing instructions, but it is not implemented as a real CLI handler. This causes agents, especially Codex, to confuse prompt names with executable CLI commands and invent `aigon feature-submit` as a shell command. At the same time, `feature-do` already intends to own the full implementation flow, including the final `aigon agent-status submitted` signal. This feature removes `feature-submit` from code and docs, and tightens `feature-do` so agents cannot truthfully claim completion until the submission signal has succeeded.

## User Stories

- [ ] As a developer using `feature-do`, I have one clear completion path: the agent finishes implementation by running `aigon agent-status submitted`, not by guessing between multiple submit mechanisms.
- [ ] As a Codex user, I do not see `feature-submit` presented as a runnable command when it is not actually implemented, so the agent does not improvise a nonexistent CLI command.
- [ ] As a maintainer, I can rely on `feature-do` to define the canonical worktree/drive completion contract for feature implementation.

## Acceptance Criteria

- [ ] All agent-facing docs, templates, and help text stop presenting `feature-submit` as a normal feature workflow command
- [ ] `feature-submit` is removed from command metadata, prompt-install outputs, and other command lists where it appears as if it were a supported command
- [ ] `feature-do` explicitly states that implementation is not complete until `aigon agent-status submitted` exits successfully
- [ ] `feature-do` explicitly tells the agent not to say "done", "complete", or "ready for review" before `aigon agent-status submitted` succeeds
- [ ] `feature-do` explicitly tells the agent not to improvise with `feature-submit`, `feature-close`, or other substitute commands if `aigon agent-status submitted` fails
- [ ] `feature-do` explicitly tells the agent to report the exact error and stop for user guidance if the submit signal fails
- [ ] Codex-specific installed docs/prompts no longer say the agent "must run" `feature-submit` as the standard completion step after `feature-do`
- [ ] `next`/help text and other workflow guidance point users to `feature-do` + `aigon agent-status submitted` instead of `feature-submit`
- [ ] `research-submit` remains intact; this feature only removes `feature-submit`

## Validation

```bash
node -c lib/templates.js
node -c lib/commands/setup.js
node -c lib/commands/misc.js
npm test
```

## Technical Approach

Update the prompt/docs layer and command metadata together so the workflow contract is internally consistent.

### 1. Remove `feature-submit` from the public model

Clean up:
- `templates/generic/docs/agent.md`
- `docs/agents/codex.md` and the generated agent docs/templates that inherit from the generic agent doc
- `templates/generic/commands/help.md`
- `templates/help.txt`
- `templates/generic/commands/next.md`
- `lib/templates.js`
- any agent config or install surface that lists `feature-submit` as an available command

The goal is that agents no longer see `feature-submit` advertised as a standard feature workflow step unless there is a real executable command behind it.

### 2. Make `feature-do` the canonical completion contract

Strengthen `templates/generic/commands/feature-do.md` so the final section clearly says:
- your work is not complete until `aigon agent-status submitted` succeeds
- do not claim completion before that command succeeds
- if the command fails, report the exact error and stop
- do not improvise with `feature-submit` or `feature-close`

This should be written as a hard workflow rule, not a soft suggestion.

### 3. Keep submit semantics in the implemented CLI path

The actual implemented submit signal today is `aigon agent-status submitted` in `lib/commands/misc.js`. This feature does not replace that mechanism; it aligns prompts and docs around it.

## Dependencies

- `templates/generic/commands/feature-do.md`
- `templates/generic/docs/agent.md`
- `templates/generic/commands/help.md`
- `templates/generic/commands/next.md`
- `templates/help.txt`
- `templates/agents/cx.json`
- `lib/templates.js`

## Out of Scope

- Reintroducing `feature-submit` as a real CLI handler
- Changing `research-submit`
- Changing feature-close, feature-eval, or research workflow semantics
- Changing the `agent-status submitted` implementation itself

## Open Questions

- Should `feature-submit` be removed completely from every leftover reference, or kept only as a clearly marked legacy/manual prompt artifact?
- Should `feature-do` include a short final self-checklist before the agent responds to the user?

## Related

- Feature: fix-autopilot-to-use-workflow-core-engine
- `templates/generic/commands/feature-do.md`
- `templates/generic/docs/agent.md`
- `docs/agents/codex.md`
