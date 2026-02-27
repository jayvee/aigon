# Feature: Shell-Launch Agent for Feature Implement

## Summary

Today `aigon feature-implement <ID>` behaves as an instruction helper: it detects the current mode, prints the spec/log paths, and tells the user what to do next. That works inside an already-running agent session, but it is incomplete from a plain shell. This feature upgrades `feature-implement` so that when it is invoked from a normal terminal and not from inside an active agent session, Aigon can launch an implementation agent directly. The agent should be selectable with `--agent=<id>`, default to `cc`, and inherit the existing agent CLI config, model config, and prompt conventions.

## User Stories

- [ ] As a developer working from a plain shell, I want `aigon feature-implement 13` to actually start an implementation agent instead of only printing instructions
- [ ] As a developer, I want `aigon feature-implement 13 --agent=cx` to launch Codex directly so I can choose my preferred agent without going through `worktree-open`
- [ ] As a developer already inside an agent session, I want `aigon feature-implement 13` to keep the current non-launching behavior so Aigon does not create nested agent sessions
- [ ] As a developer, I want the launched command to use the same agent flags and model selection logic as `worktree-open` so shell-driven and terminal-driven workflows stay consistent

## Acceptance Criteria

### CLI Behavior

- [ ] `aigon feature-implement <ID>` accepts an optional `--agent=<cc|gg|cx|cu>` flag in non-Ralph mode
- [ ] When `--ralph` is not present and no active agent session is detected, `aigon feature-implement <ID>` launches an implementation agent instead of only printing instructions
- [ ] In plain-shell mode with no `--agent` provided, the default agent is `cc`
- [ ] `aigon feature-implement <ID> --agent=cx` launches the configured Codex CLI for that feature
- [ ] If an unknown agent ID is passed, Aigon exits with a clear error listing supported agent IDs

### Agent Session Detection

- [ ] When `aigon feature-implement <ID>` is run from inside an active agent session, Aigon preserves the current behavior: show feature context and next steps, but do not launch another agent
- [ ] Nested launch prevention is explicit and documented in output so the user understands why no new agent was started
- [ ] Detection is implemented in a shared helper so it can be reused by future shell-launch commands

### Launch Semantics

- [ ] Shell-launched `feature-implement` uses the same resolved agent CLI config precedence as the rest of Aigon: project config > global config > template default
- [ ] Shell-launched `feature-implement` uses the same prompt shape as `buildAgentCommand(..., 'implement')`, including model injection where supported
- [ ] Claude launch still unsets `CLAUDECODE` before spawning to avoid nested-session failures
- [ ] Cursor continues to warn when model config exists but cannot be applied programmatically
- [ ] Launch output shows the exact agent, command, and working directory being used

### Mode Handling

- [ ] In solo branch mode, Aigon launches the selected agent in the current repository/branch
- [ ] In solo worktree mode, Aigon launches the selected agent in the current worktree
- [ ] In arena worktree mode, Aigon launches the selected agent only when the requested agent matches the current worktree agent; otherwise it exits with a clear mismatch error
- [ ] Existing instruction-only output remains available in agent-session contexts and when launch is not possible

### Ralph Compatibility

- [ ] `aigon feature-implement <ID> --ralph` keeps its current looping behavior
- [ ] Ralph continues to support `--agent=<id>` independently of the non-Ralph launch path
- [ ] Non-Ralph `--agent` semantics are documented distinctly from Ralph so users understand that one starts a single interactive agent session and the other runs the iterative loop

### Documentation

- [ ] `docs/GUIDE.md` is updated to explain the new shell-only behavior of `feature-implement`
- [ ] Agent docs clarify that `feature-implement` now has two modes: instruction mode inside an agent session, launch mode from a plain shell
- [ ] Help text for `aigon feature-implement` includes the new `--agent=<id>` option and explains the default of `cc`

## Technical Approach

Add a helper such as `detectActiveAgentSession()` that determines whether Aigon is currently running inside Claude Code, Gemini CLI, Codex, Cursor, or another supported agent host. `feature-implement` should call this helper before the existing instruction-printing path.

If no active agent session is detected and `--ralph` is absent:

1. Resolve the target agent from `--agent` or default to `cc`
2. Build a launch command using the same config resolution and model-aware command builder used by `worktree-open`
3. Spawn the selected agent in the current branch/worktree context
4. Print a concise launch summary before handing control to the agent

To avoid duplicated logic, refactor the current command-building path so `feature-implement`, `worktree-open`, and future shell-launch commands share one implementation-launch helper.

For worktree contexts, validate that the requested agent is compatible with the current worktree naming convention. Aigon should not silently launch `cc` inside a `feature-13-cx-*` worktree.

## Dependencies

- Feature 19: Model Selection Core
- Existing `worktree-open` agent command builder and terminal launch helpers

## Out of Scope

- Launching multiple agents from `feature-implement` in one command
- Changing Ralph's overall loop design
- Replacing `worktree-open` for arena side-by-side workflows
- Auto-selecting the "best" agent based on feature contents

## Open Questions

- [ ] What is the most reliable cross-agent signal for "already inside an agent session" for Gemini, Codex, and Cursor, not just Claude?
- [ ] Should there be an explicit `--no-launch` escape hatch for users who want the old instruction-only behavior from a plain shell?
- [ ] Should branch-mode launches open a new terminal window/tab for interactive agents, or should they attach directly in the current shell?

## Related

- Feature 16: Ralph Wiggum
- Feature 19: Model Selection Core
- Feature: Open worktrees in side-by-side tabs
