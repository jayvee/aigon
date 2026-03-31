# Implementation Log: Feature 192 - speed-up-agent-feature-builds
Agent: cc

## Progress

- Trimmed `feature-do.md` template: removed task creation, added time budget, reordered commit-before-test
- Set `.aigon/config.json` with `instructions.testing: "skip"` and `instructions.planMode: "never"`
- Modified `feature-do` CLI command to print spec content inline (saves agent a file read step)
- Enhanced worktree permissions with broader Bash access (aigon, node, npm)
- Verified config hash change detection works for triggering reinstall

## Decisions

- Kept `isLight` behavior as-is (requires both testing=skip AND logging=skip) — we only set testing to skip, logging stays full. This means AUTONOMOUS_SECTION and TROUBLESHOOTING_SECTION still render, which is fine.
- Plan mode set to "never" rather than relying on isLight — explicit is better.
- Spec content printed with clear delimiters so the agent knows it's already in context.
- Added `Bash(aigon:*)`, `Bash(node:*)`, `Bash(npm:*)` permissions to worktrees — these are the most common commands agents need without prompts.
