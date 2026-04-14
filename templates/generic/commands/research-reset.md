<!-- description: Reset research <ID> - return to fresh backlog state -->
# aigon-research-reset

Reset a research topic back to a fresh backlog state.

```bash
aigon research-reset {{ARG1_SYNTAX}}
```

## What this does

`research-reset` performs research-specific cleanup in one command:
1. Closes active sessions for the research ID
2. Removes findings logs (`research-<id>-*-findings.md`)
3. Removes research status files in `.aigon/state/`
4. Removes matching heartbeat files for research agents
5. Moves the spec back to `docs/specs/research-topics/02-backlog/`
6. Removes workflow engine state in `.aigon/workflows/research/<id>/`

Reset is idempotent. Running it again after cleanup is a no-op.

## Argument Resolution

If no ID is provided, or the ID doesn't match an active research topic:
1. List research specs in `03-in-progress/`, `04-in-evaluation/`, and `06-paused/`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

ARGUMENTS: {{ARG1_SYNTAX}}
