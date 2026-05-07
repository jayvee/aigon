---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T01:45:58.310Z", actor: "cli/feature-prioritise" }
---

# Feature: km inject via /skill: command instead of tmux paste-buffer

## Summary

When Kimi (`km`) is launched for spec-review, code-review, or any other role, the current injection subshell pastes the full markdown body of the command template into Kimi's TUI via `tmux paste-buffer`. This is fragile: the paste is multi-KB, timing-dependent (the 1.5 s post-marker sleep may not be enough for all auth speeds), and hard to debug. Kimi's CLI natively supports `/skill:aigon-<command> <id>` invocations — as confirmed by a user manually running `/skill:aigon-feature-spec-review 482` and watching it execute correctly. This feature replaces the paste-buffer approach for km with a short `tmux send-keys` injection of the skill command string, making injection reliable, instant, and easy to observe.

## User Stories

- As a user launching a km spec-review or code-review from the dashboard, I expect the command to be injected into the Kimi session automatically so I don't have to type it manually.
- As a user, I expect the injection to be robust regardless of Kimi auth speed — not a race between a fixed sleep and a multi-KB paste.

## Acceptance Criteria

- [ ] When `km` is launched with `injectPromptViaTmux: true`, the injection subshell sends `/skill:aigon-<commandname> <id>` via `tmux send-keys -l` (literal) followed by `Enter`, instead of loading a file into a tmux paste-buffer and pasting it.
- [ ] The skill command string is derived from the agent's `CMD_PREFIX` placeholder and the command name (e.g. `CMD_PREFIX="aigon-"` → `/skill:aigon-feature-spec-review 482`).
- [ ] The new injection path is gated by a new agent capability flag `injectViaTmuxSkillCommand: true` in `km.json` — the existing paste-buffer path remains the default for agents without this flag (op/opencode).
- [ ] The readiness marker logic and poll loop remain unchanged (still waits for authenticated state before injecting).
- [ ] `npm run test:iterate` passes.

## Technical Approach

The injection subshell in `lib/worktree.js` `buildAgentCommand` (lines ~701–727) currently does:
```
tmux load-buffer -b ... <promptfile>
tmux paste-buffer -b ... -t $session -d
tmux send-keys -t $session Enter
```

Add a branch: when `wt._injectSkillCommand` is set (a short string like `/skill:aigon-feature-spec-review 482`), use instead:
```
tmux send-keys -t $session -l "<skillcommand>"
tmux send-keys -t $session Enter
```

To populate `wt._injectSkillCommand`, in `buildRawAgentCommand` (around line 361), when `cliConfig.injectPromptViaTmux` is true AND the agent has `injectViaTmuxSkillCommand: true`, build the skill command string from `CMD_PREFIX` + command name + featureId and stash it on `wt._injectSkillCommand` instead of relying on `_injectPromptFile`.

The skill command format is `/skill:${CMD_PREFIX}${commandName} ${featureId}` — note the leading `/skill:` prefix is hardcoded (it's Kimi's skill invocation syntax, not part of CMD_PREFIX).

Add `"injectViaTmuxSkillCommand": true` to `km.json` under `cli`.

No changes needed to the marker/poll logic.

## Dependencies

- None.

## Out of Scope

- Changing the injection approach for `op` (OpenCode) — it does not use `/skill:` syntax.
- Modifying the readiness marker or timeout values.

## Open Questions

- None.

## Related

- Set: standalone
