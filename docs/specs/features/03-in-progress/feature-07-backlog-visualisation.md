# Feature: backlog-visualisation

## Summary

Create a unified `aigon board` command that displays features and research topics in both Kanban board view (default) and detailed list view (with `--list` flag). This replaces `feature-list` and provides a clean, visual way to understand project status inspired by backlog.md.

## User Stories

- As a developer, I want one command to see all work at a glance in either Kanban or list format
- As a project manager, I want to quickly understand what's in progress, prioritized, and completed
- As a team lead, I want to see both features and research topics together to understand the full scope

## Acceptance Criteria

- [ ] New command `aigon board` displays Kanban-style visualization by default
- [ ] `aigon board --list` displays detailed list view (replaces current `feature-list`)
- [ ] Shows features across columns: Inbox, Backlog, In Progress, In Evaluation, Done
- [ ] Shows research topics across columns: Inbox, Backlog, In Progress, Done
- [ ] Displays feature/research numbers (IDs) and names
- [ ] Shows count of items in each column
- [ ] Supports filtering: `--features`, `--research`, `--active`, `--all`, `--inbox`, `--backlog`, `--done`
- [ ] Remove `feature-list` command entirely
- [ ] Update README with example `aigon board` outputs (both Kanban and list views)
- [ ] Compact Kanban layout fits in standard terminal width (80-120 chars)

## Technical Approach

**1. Remove existing command:**
- Delete `feature-list` from COMMANDS object (lines 2598-2721)

**2. Add unified `board` command:**
- Add to COMMANDS object with signature: `board: (args) => { ... }`
- Parse flags: `--list`, `--features`, `--research`, `--active`, `--all`, `--inbox`, `--backlog`, `--done`
- Default behavior: Kanban view of both features and research
- With `--list`: detailed list view (migrate feature-list logic)

**3. Implement two display modes:**

**Kanban View (default):**
```
╔═══════════════════ Aigon Board ═══════════════════╗

FEATURES
┌──────────┬──────────┬──────────────┬────────────┬──────┐
│ Inbox    │ Backlog  │ In Progress  │ Evaluation │ Done │
├──────────┼──────────┼──────────────┼────────────┼──────┤
│ parallel │ #3 arena │ #7 board viz │ #6 readme  │ #1 … │
│ refactor │          │ #2 unify     │            │ #4 … │
│ (2)      │ (1)      │ (2)          │ (1)        │ (5)  │
└──────────┴──────────┴──────────────┴────────────┴──────┘

RESEARCH
┌──────────┬──────────┬──────────────┬──────┐
│ Inbox    │ Backlog  │ In Progress  │ Done │
├──────────┼──────────┼──────────────┼──────┤
│ perf-opt │ #1 auth  │ #2 caching   │ #3 … │
│ (1)      │ (1)      │ (1)          │ (1)  │
└──────────┴──────────┴──────────────┴──────┘
```

**List View (`--list`):**
```
FEATURES

Inbox (2):
   parallel-features
   refactor-aigon-sub-commands

Backlog (1):
   #3  arena-research

In Progress (2):
   #7  board-viz  solo (branch) *
   #2  unify-workflow  arena (cc, gg)

Evaluation (1):
   #6  readme-uplift

Done (5):
   #1  support-hooks
   #4  add-sample-chat
   ...

RESEARCH

In Progress (1):
   #2  caching-strategy  solo (branch)
```

**4. Implementation details:**
- Reuse folder scanning logic from current `feature-list`
- Add `displayKanbanBoard()` helper function
- Add `displayDetailedList()` helper function (refactored from feature-list)
- Share filtering logic between both views
- For Kanban: truncate long names to fit column width (~10-15 chars)

**5. Update README:**
- Add "Visualizing Work" section with example outputs
- Show both `aigon board` (Kanban) and `aigon board --list` examples
- Update command reference to remove `feature-list`, add `board`

## Dependencies

- Existing PATHS configuration (features and research structures)
- Current folder naming conventions (01-inbox, 02-backlog, etc.)
- Feature/research file naming patterns
- Box-drawing characters (Unicode support in terminal)

## Out of Scope

- Interactive UI (arrow key navigation, selection)
- Color coding by agent or priority
- Moving items between columns via the board command
- Web-based dashboard
- Progress bars or completion percentages
- Exporting board to markdown file (can add later)

## Open Questions

- ✅ Should we keep feature-list for backward compatibility? → NO, remove it
- Column width for Kanban: fixed or adaptive based on content?
- Should Kanban view show work mode indicators (solo/arena)?

## Related

- Research: Inspired by backlog.md, taskell, clikan
- Existing commands: `feature-list` (to be removed)
- Related code: Current `feature-list` implementation (lines 2598-2721)
