# Feature: log-status-tracking

## Summary

Add a `status` field to the front matter of implementation log files so any process (CLI, daemon, dashboard) can read agent state without watching terminals. Agents update the field at key lifecycle transitions via a new `aigon agent-status <status>` command. A new `aigon status [ID]` command reads these files and prints a per-agent status table — works for solo, worktree, and arena modes. This is the foundation all conductor features build on.

## User Stories

- [ ] As a developer in arena mode, I want to run `aigon status 30` and see at a glance which agents are done and which are still working, without opening any terminals
- [ ] As a developer in solo mode, I want the same status visibility even though there's only one agent
- [ ] As a developer, I want agents to automatically mark themselves `waiting` when they finish so I know when to come back and review

## Acceptance Criteria

- [ ] Implementation log files support YAML front matter with `status` and `updated` fields
- [ ] `aigon feature-setup` initialises log file front matter as `status: implementing` when creating the log
- [ ] `feature-implement.md` template instructs agents to run `aigon agent-status implementing` at the start of Step 3
- [ ] `feature-implement.md` template instructs agents to run `aigon agent-status waiting` just before the STOP/WAIT in Step 4
- [ ] `feature-submit.md` template instructs agents to run `aigon agent-status submitted` after the final commit
- [ ] New CLI command `aigon agent-status <status>` detects feature ID and agent from current branch, updates front matter in the log file in-place (no git commit)
- [ ] New CLI command `aigon status [ID]` reads matching log files and prints a status table
- [ ] `aigon status` with no ID shows all in-progress features
- [ ] `aigon status <ID>` shows per-agent status for that feature
- [ ] Solo mode log files (no agent suffix in filename) display as a single `solo` row
- [ ] Status values are: `implementing`, `waiting`, `submitted`
- [ ] `node --check aigon-cli.js` passes

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Who sets the status (writers)

Status is written in two ways:

1. **`aigon feature-setup`** (CLI, runs on main) — initialises the log file with `status: implementing` when it creates the log.
2. **`aigon agent-status <status>`** (CLI, run by the agent inside its worktree) — updates the front matter in-place at key lifecycle points. Agents call this because the `feature-implement.md` and `feature-submit.md` templates instruct them to at specific steps.

### Who reads the status (readers)

- **`aigon status [ID]`** — new CLI command; humans run this in a terminal to see a quick table.
- **conductor-daemon** (future feature) — polls log files every 30s and sends notifications.
- **conductor-menubar** (future feature) — reads log files from the plugin script for the menubar count.
- **conductor-web-dashboard** (future feature) — `/api/status` endpoint reads log files for the browser view.

### Front matter format

Log files gain a front matter block prepended at the top:

```markdown
---
status: waiting
updated: 2026-03-03T11:23:00Z
---

# Implementation Log: feature-30-cc-board-action-hub
...
```

### `aigon agent-status <status>`

Called **by the agent** (not the developer) as instructed by templates:

- Detects branch with `git branch --show-current`
- Parses feature ID and agent from `feature-<ID>-<agent>-<desc>` (arena/worktree) or `feature-<ID>-<desc>` (solo)
- Globs for the matching log file in `docs/specs/features/logs/`
- Reads file, replaces front matter block if present, or prepends it if absent
- Writes back — no git commit, just a file edit

### `aigon status [ID]`

Called **by the developer** to inspect current state:

- If ID given: glob `logs/feature-<ID>-*-log.md`
- If no ID: find all features in `03-in-progress/`, glob their log files
- Parse front matter from each, extract agent from filename
- Print table:

```
#30  board-action-hub
  cc    waiting      11:23
  gg    implementing  11:15
  cx    submitted    10:58

#06  tmux-conductor
  solo  waiting      09:44
```

### Front matter parsing

Simple regex — no YAML library needed:
```js
const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
```

### Template changes

Two lines added to `feature-implement.md` worktree section and one to `feature-submit.md`. No structural changes.

## Dependencies

- None — this is the foundation all conductor features build on

## Out of Scope

- Notifications (conductor-daemon)
- Multi-repo support (conductor-daemon)
- Spec file stage as front matter (separate future decision)

## Open Questions

- Should `aigon agent-status` fail silently if the log file doesn't exist yet, or create it?

## Related

- Research: #06 tmux-conductor (status contract finding)
- Feature: conductor-daemon (builds directly on this)
- Feature: ralph-auto-submit (uses `submitted` status)
