# Feature: Dashboard Worktree Preview

## Summary

When developing aigon's dashboard (HTML/JS/CSS in `templates/dashboard/`), there is no way to preview worktree changes alongside the stable main dashboard. This feature enables running multiple dashboard instances — one per worktree — each serving its own template files but sharing the same API data. This is foundational infrastructure: every future dashboard feature depends on the ability to test visual and behavioral changes.

## Problem

`ROOT_DIR = path.join(__dirname, '..')` resolves to the npm-linked aigon install (`~/src/aigon`), not the worktree. Even when an agent runs from a worktree, the dashboard serves main repo templates. There is no way to:
- Preview worktree dashboard changes live
- Compare two worktree implementations side by side
- Compare a worktree against the stable main dashboard

## User Stories

- [ ] As a user evaluating Fleet dashboard features, I want to open main + cc + gg dashboard versions side by side in three browser tabs
- [ ] As an agent implementing dashboard changes in a worktree, I want to preview my changes without restarting the main dashboard
- [ ] As a user, I want preview dashboards to start and stop automatically with the feature lifecycle

## Target Workflow

```
1. Main dashboard running:
   aigon.localhost (port 4100) → serves templates/ from main repo

2. User starts feature 180 with cc and gg:
   aigon feature-start 180 cc gg
   → worktrees created at aigon-worktrees/feature-180-{cc,gg}-pipeline-card/

3. Agent (or user) starts a preview dashboard from the worktree:
   aigon dashboard --preview
   (or: node ./aigon-cli.js dashboard --preview)

   This:
   a) Detects it's in a worktree (not main repo)
   b) Allocates a dynamic port from the dashboard port range
   c) Resolves ROOT_DIR to the WORKTREE root (not the npm-linked install)
   d) Registers with proxy → aigon-f180-cc.localhost
   e) Shares the same API data (same repos, same manifests — same poll loop)
   f) Prints: "🔀 Preview: http://aigon-f180-cc.localhost"

4. User opens three browser tabs:
   aigon.localhost            → stable main
   aigon-f180-cc.localhost    → cc's template changes
   aigon-f180-gg.localhost    → gg's template changes

5. Agents edit templates/dashboard/* → user refreshes to see changes
   (files already served with readFileSync + no-store)

6. On feature-close / sessions-close:
   Preview dashboards are killed and ports released
```

## Key Design Decision: Reuse dev-server Infrastructure

The existing `aigon dev-server` infrastructure already handles everything needed:
- **Port allocation**: `allocatePort()` assigns ports from a project's block
- **Proxy registration**: `registerDevServer(appId, serverId, port, worktreePath, pid)`
- **Process lifecycle**: PID tracking, liveness checks, cleanup on close
- **Proxy routing**: Caddy/proxy maps `{app}-{serverId}.localhost` → port
- **Multiple instances per app**: `serverId` key supports main + N worktrees

The dashboard is just another dev server. Rather than building bespoke preview infrastructure, the dashboard should register itself through the same dev-server system. The `serverId` for a preview dashboard would be the worktree identifier (e.g., `f180-cc`).

### What changes vs. current dev-server

| Concern | Current dev-server | Dashboard preview |
|---------|-------------------|-------------------|
| What's served | Project app (Next.js, Vite, etc.) | Aigon dashboard (templates/ + API) |
| ROOT_DIR | N/A (framework handles) | Must resolve to worktree, not npm-linked install |
| API layer | N/A | Must share same poll data as main dashboard |
| Startup command | `npm run dev` / framework CLI | `node ./aigon-cli.js dashboard` |
| Port source | Project's `.env.local` PORT block | Dashboard dynamic port range |

## Acceptance Criteria

- [ ] `aigon dashboard --preview` starts a preview dashboard from a worktree
- [ ] Preview dashboard serves templates from the worktree's `templates/dashboard/`
- [ ] Preview dashboard shares the same API data as the main dashboard (same repos, manifests)
- [ ] Preview dashboard gets a unique port and proxy URL (e.g., `aigon-f180-cc.localhost`)
- [ ] Multiple preview dashboards can run simultaneously (one per worktree)
- [ ] Main dashboard continues running unaffected on `aigon.localhost`
- [ ] Preview dashboards are cleaned up on `feature-close` / `sessions-close`
- [ ] `aigon dashboard --preview` errors clearly if not run from an aigon worktree

## Technical Approach

### ROOT_DIR resolution

The `--preview` flag changes how `ROOT_DIR` is determined:
- Normal: `path.join(__dirname, '..')` → npm-linked install
- Preview: `process.cwd()` (validated to contain `templates/dashboard/`)

Alternatively, pass an explicit `--template-root` flag. But `process.cwd()` is simpler since the agent is already in the worktree.

### Port allocation

Use the existing `DASHBOARD_DYNAMIC_PORT_START` / `DASHBOARD_DYNAMIC_PORT_END` range (already defined in constants). Preview dashboards claim the next available port.

### Proxy registration

```js
// Main dashboard
registerDevServer('aigon', 'dashboard', 4100, cwd, pid)

// Preview dashboard (cc worktree for feature 180)
registerDevServer('aigon', 'f180-cc', 4101, worktreePath, pid)
// → proxied as aigon-f180-cc.localhost
```

### API data sharing

Preview dashboards run the same `pollStatus()` loop — they poll the same repos and read the same manifests. No data sharing mechanism needed; each instance independently reads the filesystem. This is stateless and safe.

### Agent awareness

Dashboard features need agents to know about `--preview`. Options:
1. Add to feature-do template: "If this is a dashboard feature, run `node ./aigon-cli.js dashboard --preview` to see your changes"
2. Auto-detect: if the worktree modifies `templates/dashboard/`, the agent-status transition automatically starts a preview
3. Manual only: user starts preview from the main dashboard UI (a "Preview" button on the pipeline card)

Option 1 is simplest for now. Option 2 or 3 can come later.

### Files to modify

- `lib/dashboard-server.js` — `--preview` flag, `ROOT_DIR` override, dynamic port
- `lib/commands/infra.js` — `dashboard` command handler, `--preview` flag parsing
- `lib/proxy.js` — no changes needed (already supports multi-server per app)
- `lib/worktree.js` — cleanup preview dashboards on feature-close

## Architectural Alignment

### Feature 138 (aigon-next workflow core)

Feature 138 introduces the new workflow engine where `engine = authority, dashboard = view/controller`. In that architecture:
- The dashboard becomes a pure view layer over the workflow engine
- Preview dashboards would be even simpler: same engine, different view files
- The current approach (independent poll loops per preview) is compatible — the engine replaces manifests as the data source, but the preview concept remains the same

### Daemon (future)

If aigon moves to a daemon model:
- The daemon would own the poll loop / engine
- Dashboard instances (main + previews) would be pure HTTP frontends querying the daemon
- The preview concept simplifies further: just another HTTP server with different static files

**This feature is forward-compatible with both architectures.** The key abstraction — "serve these templates with this API data on this port" — holds regardless of whether the API data comes from a poll loop, an engine, or a daemon.

## Dependencies

- None — uses existing dev-server and proxy infrastructure

depends_on: (none — this is foundational)

## Out of Scope

- Automatic preview start on worktree creation (future enhancement)
- Preview button in the dashboard UI (future enhancement)
- Hot module reloading for templates (files are already re-read per request)
- Changing how non-dashboard features are tested

## Open Questions

- Should preview dashboards auto-open in the browser, or just print the URL?
- Should we add a `aigon dashboard list` command to show all running dashboard instances?
- Should the pipeline-card-layout-redesign feature spec list this as a dependency, or can agents commit and restart the main dashboard as a fallback?

## Related

- Feature 138: import-aigon-next-workflow-core (architectural alignment)
- Feature: pipeline-card-layout-redesign (first consumer)
- `lib/proxy.js` — dev-server registration infrastructure
- `docs/aigon-next-prototype-bootstrap.md` — engine/dashboard/orchestrator separation
