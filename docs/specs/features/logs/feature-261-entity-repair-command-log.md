# Implementation Log: Feature 261 - entity-repair-command

## Plan

Implement `aigon repair <feature|research> <id>` as a first-class command, keep the behavior conservative, and surface a dry-run diagnosis before any mutation.

## Progress

Added the command handler in `lib/commands/misc.js`, registered it in `lib/templates.js`, and added a regression test that checks registration and command metadata.

The implementation inspects visible spec state, workflow snapshots, runtime state files, heartbeats, sessions, worktrees, and branches. It prints a diagnosis and planned repair actions before doing anything.

I validated the command path with `node tests/integration/repair-command.test.js` and the full `npm test` suite.

## Decisions

- v1 scope is limited to `feature` and `research`.
- The command refuses to act when it sees dirty work or unmerged branches, rather than trying to guess.
- Destructive cleanup of stale worktrees or branches requires an explicit confirmation prompt.
- The command now avoids false "not found" errors when the entity exists but is already clean.
