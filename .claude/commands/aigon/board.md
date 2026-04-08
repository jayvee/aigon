---
description: Show Kanban board or list view
argument-hint: "[--list] [--features] [--research] [--active] [--all] [--inbox] [--backlog] [--done] [--no-actions]"
---
# aigon-board

Visualize features and research topics in Kanban board or detailed list view.

**IMPORTANT**:
- After running the command, display the board output **directly in your response text** (not just as a tool result) so the user can see it without expanding collapsed output. Copy the full output verbatim into a code block in your response.
- The board output includes `→ /command` action hints — make sure these are visible in your response, as they are the primary value of the board.
- When suggesting what to work on next, reference items by their letter labels (e.g., "You could prioritize item c) create-plugin") and use the agent's native Aigon command format for suggestions (e.g., `/aigon:feature-prioritise c`) rather than raw `aigon ...` CLI syntax.

```bash
aigon board {{args}}
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
- `--no-actions`: Suppress `→ /command` action hints (clean view for scripting)

## Indicators (Kanban View)

- `*` = current active branch
- `[F]` = Fleet mode
- `[AP]` = Autopilot mode
- `a), b), c)...` = letter shortcuts for quick prioritization

## Quick Prioritize

Unprioritized inbox items show letter labels. Use them for quick prioritization:

```bash
# After running 'aigon board' and seeing:
# a) base-port-config
# b) create-plugin

aigon feature-prioritise b    # Quickly prioritizes "create-plugin"
aigon research-prioritise i   # Works for research too
```

Letters are saved in `.aigon/.board-map.json` (expires after 24 hours).

## Example: Kanban View

```
╔═══════════════════════ Aigon Board ════════════════════════╗

FEATURES
┌──────────────────────┼──────────────────────┼──────────────────────┐
│ Inbox                │ Backlog              │ In Progress          │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ billing-integration  │ #13 dark-mode        │ #11 search-api [AP]  │
│ email-templates      │                      │ #12 notifications *  │
│                      │                      │ #14 profile-rede [F] │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ (2)                  │ (1)                  │ (3)                  │
└──────────────────────┼──────────────────────┼──────────────────────┘

Next actions:
  billing-integration        → /afn billing-integration
  email-templates            → /afn email-templates
  #13 dark-mode              → /afs 13
  #11 search-api             → /afd 11
  #12 notifications          → /afd 12
  #14 profile-redesign       → /afe 14

RESEARCH
┌──────────────────────┼──────────────────────┼──────────────────────┐
│ Inbox                │ Backlog              │ In Progress          │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ api-performance      │ #01 auth-patterns    │ #02 caching-strat *  │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ (1)                  │ (1)                  │ (1)                  │
└──────────────────────┼──────────────────────┼──────────────────────┘

Next actions:
  api-performance            → /arp api-performance
  #01 auth-patterns          → /ars 01
  #02 caching-strategy       → /ardn 02
```

## Example: List View

```bash
aigon board --list --active
```

Output:
```
FEATURES

In Progress (3):
   #11  search-api
          → /afd 11
   #12  notifications       Drive (branch) *
          → /afd 12
   #14  profile-redesign    Fleet (cc, gg) [F]
          → /afe 14

RESEARCH

In Progress (1):
   #02  caching-strategy    Drive (branch) *
          → /ardn 02
```

## Usage Tips

- Use **Kanban view** for quick status checks and standups
- Use **list view** (`--list`) when you need full names and details
- Combine filters: `aigon board --features --list --active`
