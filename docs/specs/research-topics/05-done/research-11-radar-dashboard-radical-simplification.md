# Research: Radar Dashboard Radical Simplification

## Context

The current radar/dashboard stack has accumulated too many layers through iterative AI agent additions: a daemon process, PID files, a Caddy reverse proxy, dnsmasq, a server registry, WebSocket terminal relay, tmux session management, a state machine, and dual polling loops. This complexity makes it unreliable in practice:

- Can't run radar on a worktree while another radar instance runs on main (port/registry conflicts)
- WebSocket→tmux relay is racy and frequently fails silently
- 5 documented failure modes that all require manual intervention
- Restarting radar is required after every backend code change, which agents forget
- The dashboard HTML is 3,666 lines of inlined CSS/JS with no module boundaries
- AI agents cannot reliably fix bugs in this stack because testing requires a daemon + Caddy proxy + live tmux session all running simultaneously

The product direction is also clarifying: **only the dashboard matters**. The menubar app and VS Code extension are companion surfaces that add maintenance burden without significant user value. This research should assume they are retired.

Previous attempts to fix radar have added complexity (SSE live-reload, file watchers, health-check polling). The goal here is the opposite: find the architecture with the fewest moving parts that delivers reliable status visibility and basic operator actions.

## The Core Dev Loop Constraint

Aigon is built using Aigon. This is the hardest constraint the architecture must satisfy:

- The **production copy** of radar runs on `main` — the user uses it to manage active features, watch agent progress, and trigger actions
- The **development copy** runs in a worktree (e.g. `feature-70-cc-radar-rebuild`) — agents make changes there and need to test them end-to-end
- Both must run **simultaneously** without conflicting
- Changes to the dashboard must be verifiable in the dev worktree without disrupting the production copy

Currently this is impossible: both instances fight over port 4100, the Caddyfile, and the server registry. The result is that agents either can't test dashboard changes end-to-end, or they break the production radar while testing. This is why dashboard changes keep regressing — they were never properly tested.

Any replacement architecture must make this dev loop work as a first-class concern, not an afterthought.

## Questions to Answer

- [ ] What does the dashboard actually need to do that users rely on? (status visibility, launching agents, board actions — vs what was built but doesn't work reliably like live terminal relay)
- [ ] How does the architecture support running a production copy (main) and a dev copy (worktree) simultaneously without conflict? What ports, registries, or state do they need to isolate?
- [ ] Can a dev copy of radar serve a modified dashboard against live production data (from the main repo's state files), so dashboard UI changes can be tested realistically without running a full parallel agent fleet?
- [ ] Can the Caddy/dnsmasq proxy stack be eliminated entirely? What is lost if the dashboard is just `http://localhost:4100`? Would `http://localhost:4101` for dev be sufficient?
- [ ] Can the WebSocket terminal relay be removed without losing essential functionality? What would replace it for the use cases that actually matter?
- [ ] Can the dashboard work without a long-running daemon? What would a request-time or on-demand model look like?
- [ ] What does a minimal but reliable dashboard look like — the smallest surface area that would actually be used and trusted?
- [ ] Should the menubar app and VS Code extension be retired entirely, or is there a minimal form worth keeping?
- [ ] What is the migration path from the current stack to a simpler one without disrupting the running production copy?

## Scope

### In Scope

- The AIGON server, its HTTP server, WebSocket relay, and all supporting infrastructure (PID files, Caddy, dnsmasq, registry)
- The dashboard HTML/JS/CSS (`templates/dashboard/index.html`)
- The dev loop: running production radar (main) and dev radar (worktree) simultaneously without conflict
- Multi-instance behaviour (main repo + worktrees) as a first-class requirement
- What operator actions the dashboard should support and how they execute
- Whether the menubar app and VS Code extension should be retired
- A recommended replacement architecture with clear tradeoffs

### Out of Scope

- New feature additions to the dashboard (features come after a stable foundation)
- Remote/cloud or multi-user scenarios
- Mobile or cross-platform concerns
- The dev-server proxy stack (separate from radar, mostly works)

## Seed Notes

These are hypotheses to validate or reject — not conclusions.

**What the dashboard must keep:**
The user relies on the dashboard as their primary control surface for Aigon: moving features between stages, prioritising, setting up worktrees, triggering agent runs, watching progress. This interactive operator functionality is the core value and must be preserved in any replacement architecture. What can be removed is the fragile infrastructure underneath it, not the interactions themselves.

**Hypothesis A: Minimal daemon, actions via CLI subprocess**
Keep a simple HTTP server but replace the WebSocket terminal relay with a model where operator actions (feature-setup, feature-do, etc.) are triggered by the dashboard POSTing to a Radar API endpoint which spawns the relevant CLI command in a tmux session via `worktree-open` (which already works reliably). The dashboard shows status via polling. No WebSocket needed for the happy path. Terminal viewing is a separate, lower-priority concern.

**Hypothesis B: Minimal daemon, no proxy**
Keep a simple HTTP server but drop Caddy/dnsmasq entirely. Dashboard is at `http://localhost:4100`. No Caddyfile, no dnsmasq, no `/etc/resolver/test`. Loses the pretty `.test` domains. Gains: works immediately after `npm install`, no root processes, no setup ceremony.

**Hypothesis C: Keep daemon, fix multi-instance**
Instead of a single daemon, each worktree runs its own radar on an auto-allocated port. A lightweight port-discovery mechanism lets a primary view aggregate across instances. No single point of failure, no port conflicts.

**On retiring menubar + VS Code extension:**
Both surfaces duplicate functionality from the terminal CLI and dashboard. The menubar requires a separate Electron-style process. The VS Code extension was intentionally read-only. Neither is actively maintained. The research should evaluate whether retiring them simplifies the overall system meaningfully.

**On the WebSocket terminal relay:**
The current implementation creates a tmux session and relays I/O over WebSocket. It fails when the tmux session dies before the WebSocket connects, when the session name conflicts, and when the AIGON server is restarted mid-session. An alternative: the dashboard triggers agent sessions via `aigon worktree-open` (which already works reliably in the terminal), and the dashboard simply shows status rather than hosting a terminal.

## Findings

### Consensus (cc + gg)

All questions were answered with strong convergence between cc and gg (cx did not complete findings).

**What must be kept:** All interactive operator functionality — monitor view with feature cards, pipeline/kanban board, operator action buttons (setup, feature-do, eval, close), spec drawer, analytics, logs view. These are the core value. Analytics and logs stay in the dashboard — they give the user a powerful overview of their Aigon usage and must not be deferred or moved to CLI.

**What can be removed:**
- WebSocket terminal relay (xterm.js, pipe-pane, temp files, ~450 lines) — fails constantly; replace with "Open in Terminal" buttons that trigger native `tmux attach` via the existing `openTerminalAppWithCommand` in the CLI
- Caddy reverse proxy and dnsmasq — removes root processes, setup ceremony, 5 failure modes; `localhost:4100` is equivalent for a single-user local tool
- Daemon/PID model — replaced by a foreground server that auto-shuts down after 5 min idle; eliminates stale daemons, the `radar start/stop` lifecycle, and PID file failure modes
- Menubar SwiftBar plugin and VS Code extension — both duplicate the dashboard with significant maintenance burden

**Dev loop (dogfooding):** The port-per-instance model solves the core constraint. Main always uses port 4100. Worktrees get a deterministic port from a branch name hash (range 4101–4199). Discovery files at `~/.aigon/instances/<name>.json` enable `aigon dashboard list` and `aigon dashboard open <name>`. A dev instance reads the same filesystem data as production, so a modified dashboard can be tested against real data without a parallel agent fleet. localStorage keys must be namespaced by instance to prevent cross-instance pollution.

**Naming:** "Radar" was the daemon. Without the daemon, the concept disappears. The command becomes `aigon dashboard`. No more `radar start/stop/status` — just `aigon dashboard` which opens a browser tab and a server that shuts down when done.

### Divergent Views

- **Server model**: cc recommends on-demand foreground server with auto-shutdown; gg recommends fully stateless (filesystem read per request). Both are compatible and can be combined.
- **Dashboard JS**: cc recommends incrementally adopting Alpine.js for declarative rendering; gg did not address this.

## Recommendation

Replace the current daemon+proxy+relay stack with a foreground HTTP server and port-per-instance model. The dashboard remains the single interactive control surface with all existing operator functionality. The infrastructure underneath it is radically simplified.

**The new architecture:**
1. `aigon dashboard` starts a foreground HTTP server on port 4100 (main) or auto-allocated port (worktree), opens the browser, auto-shuts down after 5 min idle — no PID files, no daemon management
2. No Caddy, no dnsmasq — dashboard lives at `http://localhost:4100`
3. No WebSocket terminal relay — actions POST to `/api/action`, terminal sessions open via native `tmux attach` through "Open in Terminal" buttons
4. Port-per-instance with `~/.aigon/instances/*.json` discovery files — production and dev worktrees coexist without conflict
5. Retire menubar plugin and VS Code extension
6. Incrementally adopt Alpine.js for dashboard JS organisation
7. Playwright tests with `page.route()` mock API for reliable agent-testable regression suite

**What this removes:** daemon management, PID files, Caddy, dnsmasq, `/etc/resolver/test`, Caddyfile generation, server registry, WebSocket relay, xterm.js (3 CDN scripts), pipe-pane temp files, menubar generation code, VS Code extension directory and install logic — estimated ~1,200 lines of code removed.

**What this keeps:** all operator actions, status visibility, pipeline board, spec drawer, analytics, logs view, polling-based updates.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|---|---|---|---|
| `dashboard-infrastructure-rebuild` | Replace daemon+proxy+relay with foreground server, port-per-instance, drop Caddy/dnsmasq, drop WebSocket relay, retire companions, rename radar→dashboard throughout | high | `aigon feature-create "dashboard-infrastructure-rebuild"` |
| `dashboard-modernise` | Incrementally adopt Alpine.js for declarative rendering + Playwright test suite with mock API data | medium | `aigon feature-create "dashboard-modernise"` |

### Feature Dependencies

- `dashboard-modernise` should follow `dashboard-infrastructure-rebuild` (tests should target the new architecture)

### Not Selected

- `radar-dashboard-slim` (move analytics/logs to CLI): rejected — user relies on analytics and logs as a powerful overview of Aigon usage; they stay in the dashboard
