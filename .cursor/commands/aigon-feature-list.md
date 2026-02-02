# aigon-feature-list

List all features and their current status.

```bash
aigon feature-list <args>
```

## Filters

- **No arguments**: Shows all non-done features (inbox, backlog, in-progress, in-evaluation, paused)
- `--all`: Include completed features
- `--active`: Only in-progress and in-evaluation
- `--inbox`: Only inbox (unprioritized)
- `--backlog`: Only backlog (prioritized, waiting for setup)
- `--done`: Only completed features

## Output

Features are grouped by state. For in-progress features, the output includes:
- **Mode**: solo (branch), solo-wt (worktree), or arena
- **Agent(s)**: which agent is assigned
- **Location**: worktree path (if applicable)

## Example Output

```
Inbox (2):
   #00  billing-integration
   #00  email-templates

Backlog (1):
   #13  dark-mode

In Progress (3):
   #11  search-api          solo-wt (cc)  ../myapp-worktrees/feature-11-cc-search-api
   #12  notifications       solo (branch) *
   #14  profile-redesign    arena (cc, gg)

In Evaluation (1):
   #10  auth-flow           solo-wt (cc)  ../myapp-worktrees/feature-10-cc-auth-flow
```
