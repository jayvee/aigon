# Feature: Base Port Configuration

## Summary
When multiple Aigon-managed projects run agent worktrees simultaneously, their dev server ports clash because all web projects default to the same range (cc=3001, gg=3002, cx=3003, cu=3004). This feature reads the PORT from the project's `.env` file and auto-calculates arena agent ports as `PORT + offset` (PORT+1, PORT+2, PORT+3, PORT+4), avoiding duplication and keeping the `.env` file as the single source of truth for port configuration.

## User Stories
- [ ] As a developer working on multiple Aigon projects simultaneously, I want each project to use a unique port range so agent dev servers don't clash
- [ ] As a developer, I want Aigon to read my PORT from `.env` so I don't have to configure ports in two places
- [ ] As a developer setting up a project, I want to see a port summary during init/update so I know what ports are in play

## Acceptance Criteria
- [ ] Aigon reads PORT from `.env` in the project root
- [ ] Arena agent ports are derived as PORT+1 (cc), PORT+2 (gg), PORT+3 (cx), PORT+4 (cu)
- [ ] Worktrees created with `aigon feature-setup` write the correct derived PORT to `.env.local`
- [ ] Explicit `arena.ports` in `.aigon/config.json` still works and takes precedence
- [ ] `aigon profile show` displays the port configuration with source
- [ ] `aigon init`, `aigon update`, and `aigon install-agent` show a port summary
- [ ] When no PORT is in `.env`, falls back to profile defaults and suggests setting one

## Technical Approach

### Read PORT from `.env`

Add `readBasePort()` helper that parses `.env` for `PORT=<number>`.

### Derive arena ports in `getActiveProfile()`

When `.env` has PORT and the profile has dev server enabled, override default ports:
```
PORT=3800 in .env → cc=3801, gg=3802, cx=3803, cu=3804
```

Explicit `arena.ports` in `.aigon/config.json` still overrides derived values.

### Show port summary

Add `showPortSummary()` that displays:
```
📋 Ports (from .env PORT=3800):
   Main:  3800
   Arena: cc=3801, gg=3802, cx=3803, cu=3804
```

Or when no PORT in `.env`:
```
📋 Ports (defaults — no PORT in .env):
   Main:  3000 (framework default)
   Arena: cc=3001, gg=3002, cx=3003, cu=3004
   💡 Set PORT in .env to avoid clashes with other projects
```

Called during `aigon init`, `aigon update`, `aigon install-agent`, and `aigon profile show`.

### Example `.env`

```
PORT=3800
DATABASE_URL=...
```

## Dependencies
- None — self-contained change within `aigon-cli.js`

## Out of Scope
- Auto-detecting port conflicts across projects
- Dynamically assigning ports based on what's available
- Changing the default port ranges for existing profiles
- Writing PORT to `.env` (user manages their own `.env`)

## Related
- `.env` file is the standard place for PORT in web projects
- Arena mode worktree `.env.local` files override `.env` values
