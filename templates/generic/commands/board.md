<!-- description: Show Kanban board or list view -->
# aigon-board

Visualize features and research topics in Kanban board or detailed list view.

```bash
aigon board {{ARG_SYNTAX}}
```

## Views

**Default (Kanban)**: Visual board showing items across workflow stages
```bash
aigon board
```

**List view**: Detailed list with work mode indicators
```bash
aigon board --list
```

## Filters

- **No filters**: Shows both features and research (excludes done by default)
- `--features`: Show only features
- `--research`: Show only research topics
- `--active`: Only in-progress items
- `--all`: Include completed items
- `--inbox`: Only inbox (unprioritized)
- `--backlog`: Only backlog (prioritized, waiting)
- `--done`: Only completed items

## Indicators (Kanban View)

- `*` = current active branch
- `[2]` = arena mode (2 agents)
- `[wt]` = solo worktree mode

## Example: Kanban View

```
╔═══════════════════════ Aigon Board ════════════════════════╗

FEATURES
┌──────────────────────┼──────────────────────┼──────────────────────┐
│ Inbox                │ Backlog              │ In Progress          │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ billing-integration  │ #13 dark-mode        │ #11 search-api [wt]  │
│ email-templates      │                      │ #12 notifications *  │
│                      │                      │ #14 profile-rede [2] │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ (2)                  │ (1)                  │ (3)                  │
└──────────────────────┼──────────────────────┼──────────────────────┘

RESEARCH
┌──────────────────────┼──────────────────────┼──────────────────────┐
│ Inbox                │ Backlog              │ In Progress          │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ api-performance      │ #01 auth-patterns    │ #02 caching-strat *  │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ (1)                  │ (1)                  │ (1)                  │
└──────────────────────┼──────────────────────┼──────────────────────┘
```

## Example: List View

```bash
aigon board --list --active
```

Output:
```
FEATURES

In Progress (3):
   #11  search-api          solo-wt (cc)  ../myapp-worktrees/feature-11-cc-search-api
   #12  notifications       solo (branch) *
   #14  profile-redesign    arena (cc, gg)

RESEARCH

In Progress (1):
   #02  caching-strategy    solo (branch) *
```

## Usage Tips

- Use **Kanban view** for quick status checks and standups
- Use **list view** (`--list`) when you need full names and details
- Combine filters: `aigon board --features --list --active`
