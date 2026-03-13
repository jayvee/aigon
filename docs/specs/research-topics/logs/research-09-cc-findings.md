---
status: submitted
updated: 2026-03-13T08:59:45.242Z
---

# Research Findings: control surface strategy

**Agent:** Claude (cc)
**Research ID:** 09
**Date:** 2026-03-13

---

## Key Findings

### Q1. What does the current web dashboard (feature 41) already support?

**Current capabilities (feature 41, won by Codex implementation):**
- Zero-dependency self-contained HTML/JS/CSS SPA served via `http://127.0.0.1:4321`
- Live agent status across all registered repos (repos -> features -> per-agent status rows)
- Status indicators: implementing (blue pulse), waiting (amber), submitted (green check), error (red)
- Connection health indicator (green/amber/red) with auto-reconnect polling every 10s
- Favicon badge showing count of waiting agents
- Toast notifications on status transitions
- Collapsible repo sections with localStorage persistence
- Filter system (all/implementing/waiting/submitted/error) with localStorage state
- Copy-to-clipboard for slash commands and "next action" inference
- Attach button that calls `POST /api/attach` to open a terminal on a running tmux session

**Concrete gap to interactive operator console:**
1. **No session control**: Can only observe via attach, not start/stop/pause/resume agents
2. **No terminal streaming**: Status-only; no live agent terminal output in the dashboard
3. **No WebSocket push**: Uses 10s polling, not event-driven real-time updates
4. **No DOM diffing**: Full `innerHTML` replacement on poll (spec called for selective updates but this wasn't achieved)
5. **No board manipulation**: Can't create features, move across stages, prioritise, or launch implementations
6. **No bidirectional session I/O**: Can't send commands or approve prompts from the dashboard
7. **No auth**: Open localhost server, no token or authentication layer

### Q2. Can the web dashboard realistically evolve into an interactive operator console?

**Yes, and the industry pattern strongly validates this path.**

- **Railway** is the strongest precedent. Their "Canvas" interface treats infrastructure as a visual flowchart with drag-and-drop services, real-time logs, CPU/memory metrics, and direct service controls. Railway raised $100M Series B in January 2026, validating browser-based operator consoles for developer tools.

- **Vercel** chose SWR polling (not WebSockets) for most real-time dashboard updates. Even Vercel's own Functions historically didn't support WebSockets natively -- Rivet had to build a tunneling layer. This is instructive: **the engineering bar for "interactive" is lower than it appears** because polling is sufficient for state sync.

- **Render** uses xterm.js for container terminals and build/runtime log streaming in-browser -- a direct precedent for Aigon's session viewing goal.

The path from status board to operator console is well-trodden. The key enabler is WebSocket support in Radar for two channels: state subscriptions and terminal output streaming. Everything else (board controls, agent lifecycle) can layer on top of existing REST endpoints.

### Q3. Engineering costs of making the web dashboard interactive

**WebSocket infrastructure:**
- For a local service like Radar, WebSocket complexity is much lower than cloud -- no load balancers, no horizontal scaling, no CDN concerns. A single `ws` (npm package) or built-in `node:http` upgrade handler on Radar handles it.
- Two WebSocket channels needed: (a) state change subscriptions (replace 10s polling), (b) terminal output streaming (new capability).
- Connection lifecycle, reconnection, and multiplexing are the main implementation concerns.

**State management:**
- Unidirectional data flow (backend = source of truth, frontend subscribes). This mirrors what Home Assistant does with its WebSocket API.
- Current polling pattern already follows this -- WebSocket is an upgrade path, not an architecture change.
- The dashboard already caches filter/collapse state in localStorage; adding mutation support (e.g., "launch agent", "move feature") requires new REST endpoints on Radar, not fundamental redesign.

**Real-time sync:**
- State sync (feature/agent status changes): polling at 10s is already functional. WebSocket subscription would improve latency to sub-second but is not blocking for v1 interactivity.
- Terminal streaming: requires WebSocket. Read-only streaming of `tmux capture-pane` output over WebSocket is straightforward (see Q5).

**Auth:**
- A local bearer token (generated on first run, stored in `~/.aigon/config.json`, sent as `Authorization: Bearer <token>`) is the minimal viable approach. Needed before exposing mutation endpoints.

**Estimated new Radar endpoints for interactivity:**
- `POST /api/feature/create` - create a feature
- `POST /api/feature/{id}/move` - move feature to stage
- `POST /api/feature/{id}/launch` - launch implementation (start agent tmux session)
- `POST /api/feature/{id}/stop` - stop agent session
- `WS /ws/status` - subscribe to state changes
- `WS /ws/terminal/{sessionName}` - stream terminal output

### Q4. What would it take to extend `POST /api/attach` into a full session transport?

**Current state of `/api/attach`:**
- Accepts `{featureId, agentId, repoPath}`
- Validates parameters (rejects solo agents)
- Checks tmux session existence via `safeTmuxSessionExists()`
- On success: calls `openTerminalAppWithCommand()` to open a terminal with `tmux attach -t <session>`
- Returns `{ok, message, command}` or `{error}`
- This is essentially a "launch local terminal" endpoint, not a session transport

**To extend to full session transport (bidirectional I/O):**

1. **Read-only streaming (lower cost, v1):**
   - WebSocket endpoint that runs `tmux capture-pane -p -t <session>` on interval or uses tmux control mode (`tmux -C attach -t <session>`) to receive real-time pane output
   - Pipe output to connected WebSocket clients via xterm.js in the dashboard
   - Research-06 findings note: `tmux capture-pane` default scrollback is 2,000 lines; practical max 10,000-50,000 before memory issues. Rapid terminal redraws can balloon memory even with small scrollback.

2. **Bidirectional I/O (higher cost, v2):**
   - Would require `tmux send-keys` to inject input from WebSocket clients
   - Race conditions if multiple clients attach simultaneously
   - Input validation/sanitization needed (what commands should a web UI be allowed to send?)
   - Authentication per-session (who can type into which agent?)
   - Research-06 consensus: tmux control mode (`tmux -C`) is the recommended approach for real-time telemetry + input

3. **Session lifecycle management (v2+):**
   - Start new tmux sessions: `createDetachedTmuxSession()` already exists
   - Stop sessions: `tmux kill-session -t <name>`
   - Pause/resume: not natively supported by tmux; would need application-level signaling
   - Session health monitoring: tmux control mode `pane-exited` / `pane-died` hooks (recommended by research-06 but not yet implemented)

**Key prior art from research-06 (tmux conductor):**
- Recommended design: launch each agent in a detached named tmux session, use status files as authoritative state, use tmux control mode for telemetry
- Suggested `aigon watch <feature-id> [agent]` command for attach/tail workflows (not yet implemented)
- Use non-standard tmux socket to avoid conflicts with user's tmux config
- Aigon's differentiator is "headless but attachable" -- agents run detached, human can observe/intervene on demand

### Q5. Is read-only session viewing sufficient for v1?

**Yes. Read-only is dramatically simpler and sufficient for the v1 use case.**

The architecture is: backend streams PTY output over WebSocket, xterm.js renders it. No input handling, no security concerns about injecting commands.

- **Render** does exactly this for container logs and build streaming
- **Selenoid UI** streams Docker container logs over WebSocket with xterm.js
- **Proxmox VE** uses xterm.js for container terminal viewing

**Why read-only is enough for v1:**
- Aigon's current interaction model is already "observe, then intervene by opening a terminal." The dashboard attach button does this. Read-only streaming just removes the need to leave the browser to observe.
- The most common operator need is "what is my agent doing right now?" not "I need to type into my agent's terminal from the browser."
- If intervention is needed, `POST /api/attach` already opens a local terminal. The dashboard can show a "Take over in terminal" button alongside the read-only view.

**When bidirectional becomes necessary:**
- Approving agent permission prompts from the dashboard (currently requires terminal attach)
- Responding to agent questions without context-switching
- Multi-agent orchestration where an operator needs to steer several agents from one screen
- This is a Phase 2 concern after read-only streaming proves the pattern.

### Q6. What product and engineering advantages would a native macOS app provide?

**Real advantages:**
- **Ambient presence**: Always-on without a browser tab. The menubar integration (feature 39) partially addresses this already.
- **Deep OS integration**: Direct file system access, process management, notification center, menu bar, Spotlight/Raycast integration, global hotkeys.
- **Performance**: Native Swift apps achieve sub-millisecond launch (Raycast: 99.8% crash-free rate). No browser overhead.
- **Credential/keychain access**: Native apps can use macOS Keychain for secure token storage.
- **Process control**: Direct ability to spawn/manage/signal child processes (tmux, agent CLIs) without going through an HTTP layer.

**Examples:**
- **Raycast**: Native Swift, replaced Spotlight for many developers. Deep OS integration + web-tech extensions (React/TypeScript/Node) as a hybrid model.
- **TablePlus**: Direct file/socket access for database connections that would be complex in a browser sandbox.
- **Tower**: Performance advantage over Electron for large Git repositories.
- **Proxyman**: Direct network stack integration impossible from a browser.

### Q7. What would a macOS app cost?

**Direct costs:**
- **Apple Developer Program**: $99/year for signing and notarization
- **Code signing & notarization**: Mandatory for distribution outside App Store. Requires Developer ID certificate, submission to Apple's notary service, stapling. CI/CD integration adds complexity (xcrun notarytool, xcrun stapler).
- **New codebase**: Swift/SwiftUI skills are entirely different from Node.js/TypeScript. This is a second codebase to maintain.
- **Release overhead**: Each update requires re-signing, re-notarizing, distribution. Auto-update via Sparkle framework adds maintenance.

**Strategic costs:**
- **Platform lock-in**: 100% of current Aigon users are macOS, but this is a startup assumption. Native macOS locks out future Linux/Windows users entirely.
- **App Sandbox restrictions**: Sandboxed apps have restricted file system access. Aigon needs to read git repos anywhere on disk, requiring either (a) distributing outside App Store (no mandatory sandboxing), or (b) security-scoped bookmarks for user-selected directories. Either path has friction.
- **Helper process complexity**: A native app managing tmux sessions, Node.js agent CLIs, and git operations needs helper processes or XPC services. The native app becomes a second orchestration layer on top of Radar.
- **Maintenance burden**: Bug surface doubles. Testing matrix grows (macOS versions, Apple Silicon, signing edge cases). Every Radar API change needs a corresponding native client update.

### Q8. Could VS Code/Cursor serve as a transitional primary surface?

**Yes, but with significant caveats.**

**Evidence that IDE-hosted works:**
- **GitLens** (45M+ installs): Rich Git control surface entirely within VS Code. Blame, history, PR management from the sidebar.
- **Docker extension**: Full container lifecycle management, log viewing, shell attachment.
- **GitHub Copilot Chat**: WebView-based chat UI with agent-mode capabilities.
- **Remote-SSH**: Abstracts away execution location entirely.

**Aigon's VS Code extension (feature 33) is deliberately conservative:**
- The spec explicitly scopes it as read-only: "Writing or committing status from the extension (read-only view)" and "Running slash commands directly in a VS Code terminal (clipboard copy only for now)" are listed as out of scope.
- This was a deliberate design choice, not a limitation: reduces complexity, avoids IDE lock-in, keeps Aigon CLI as authoritative command layer.

**Limitations that matter for Aigon:**
- **No ambient awareness**: The extension only exists when VS Code/Cursor is open. Agents run independently of the IDE.
- **WebView constraints**: ~100K character limit observed in Copilot Chat; large outputs cause performance issues. Terminal streaming would need careful buffering.
- **UI surface area**: Sidebar panels and editor tabs. Complex multi-panel layouts (like a Kanban board with terminal viewers) are awkward.
- **Cursor compatibility risk**: Cursor is a VS Code fork. Extensions generally work, but API drift is a risk requiring testing in both.
- **Distribution**: VS Code Marketplace review process; Cursor has a separate, less mature ecosystem.

**Recommended role**: The extension should be an 80/20 companion (status glance, quick launch, jump to dashboard) rather than a full operator console. This follows the GitHub Desktop pattern: surface the most common workflows visually, send users to the full interface for complex operations.

### Q9. What sequence of bets best reduces risk while making the product easier for non-CLI-native users?

**Phase 1 (Now): Web dashboard -> interactive operator console**
- Lowest incremental cost: dashboard (feature 41) and Radar (feature 45) already exist
- Cross-platform by default -- no macOS lock-in
- Railway's canvas model validates that browser-based operator consoles work
- Vercel's SWR approach proves polling is sufficient for most state sync
- xterm.js + WebSocket from Radar is proven (Render does exactly this)
- **Risk**: Browser tab friction ("I have to open a browser"). Mitigated by PWA and existing menubar.

**Phase 2 (After dashboard is interactive): Enrich VS Code/Cursor extension**
- Users are already in the IDE; extension exists but is read-mostly
- Add 3-5 most common actions: view status, launch implementation, see agent output, jump to dashboard
- Follows the 80/20 GUI pattern -- don't replicate the dashboard
- **Risk**: Cursor compatibility drift. Mitigated by limiting extension scope.

**Phase 3 (Evaluate, don't commit): Native macOS app**
- Highest cost option; should only be pursued if Phases 1-2 prove the product model
- Signal to invest: users consistently report "I want Aigon without opening a browser or IDE"
- The menubar (feature 39) already provides ambient status. If that's insufficient, native is warranted.
- **Risk**: Platform lock-in, maintenance burden. Mitigated by Radar as shared backend.

**Why this order:**
1. The web dashboard lets the most people use Aigon interactively with the least new code
2. The IDE extension brings controls to where developers already are, without ambient-presence limitations
3. Native is the most expensive bet and should be validated by demand, not assumed

### Q10. Which responsibilities should belong to Radar versus the UI client?

**Radar (control plane) owns:**
- All business logic: feature state machine, agent lifecycle, workflow rules
- Session management: tmux create/kill/monitor, session health
- State persistence: reading specs, logs, front matter; tracking transitions
- Notification dispatch: macOS notifications, auto-eval triggers
- Auth: token validation, session authorization
- API surface: REST + WebSocket endpoints for all clients
- Terminal streaming backend: pipe tmux output to WebSocket subscribers

**UI clients (views) own:**
- Rendering and presentation
- Local UI state (collapsed sections, filters, scroll position)
- Client-specific affordances (menubar uses xbar format, VS Code uses TreeDataProvider, dashboard uses HTML/CSS)
- Navigation and discoverability (making features/actions findable)
- Input capture (clicks, drags, keyboard) translated to Radar API calls

**The key principle: Radar is the control plane, everything else is a view.**

This mirrors Home Assistant (Python backend + WebSocket API + multiple thin clients) and Docker (daemon + REST API + CLI/Desktop/third-party clients). Investing in Radar's API benefits every client simultaneously, while investing in any single client has bounded impact.

**What this means practically:**
- "Move feature to backlog" is a Radar endpoint, not dashboard logic
- "Launch agent implementation" is a Radar endpoint that creates a tmux session
- "Stream agent output" is a Radar WebSocket channel
- The dashboard, IDE extension, and menubar are all thin consumers
- The CLI remains the escape hatch for anything not yet surfaced in a GUI

## Sources

### Web Dashboard / Platform Evolution
- [Vercel, Netlify, Railway, Render: Developer Platforms in 2026](https://algeriatech.news/developer-platforms-vercel-netlify-dx-2026/)
- [Railway vs Render 2026 - The Software Scout](https://thesoftwarescout.com/railway-vs-render-2026-best-platform-for-deploying-apps/)
- [How We Built WebSocket Servers for Vercel Functions - Rivet](https://rivet.dev/blog/2025-10-20-how-we-built-websocket-servers-for-vercel-functions/)
- [Vercel Observability](https://vercel.com/products/observability)
- [Railway.app - DevOps Friendly Deployment Tool](https://dev.to/kaustubhyerkade/railwayapp-devops-friendly-deployment-tool-5aab)

### Native macOS Apps
- [Raycast App for Mac (2025)](https://albertosadde.com/blog/raycast)
- [Raycast Review 2026: Features, Pricing, Pros & Cons](https://efficient.app/apps/raycast)
- [macOS Apps: From Sandboxing to Notarization - Xojo Blog](https://blog.xojo.com/2024/08/22/macos-apps-from-sandboxing-to-notarization-the-basics/)
- [Beyond the Sandbox: Signing and distributing macOS apps outside the Mac App Store](https://www.appcoda.com/distribute-macos-apps/)
- [Automatic Code-signing and Notarization using GitHub Actions](https://federicoterzi.com/blog/automatic-code-signing-and-notarization-for-macos-apps-using-github-actions/)
- [Apple Notarizing macOS Software Documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

### VS Code/Cursor as Host Shell
- [VS Code Webview API Documentation](https://code.visualstudio.com/api/extension-guides/webview)
- [GitLens - Git Supercharged](https://gitlens.amod.io/)
- [GitHub Copilot Chat Architecture (DeepWiki)](https://deepwiki.com/microsoft/vscode-copilot-chat)
- [GitHub Copilot in VS Code](https://code.visualstudio.com/docs/copilot/overview)

### Terminal-in-Browser
- [xterm.js - A terminal for the web](https://xtermjs.org/)
- [xterm.js GitHub Repository](https://github.com/xtermjs/xterm.js/)
- [ttyd - Share your terminal over the web](https://tsl0922.github.io/ttyd/)
- [GoTTY - Share your terminal as a web application](https://github.com/yudai/gotty)
- [tty2web - improved GoTTY fork](https://pkg.go.dev/github.com/kost/tty2web)
- [How Warp Works](https://www.warp.dev/blog/how-warp-works)

### Hybrid/Multi-Client Architectures
- [Home Assistant Frontend Architecture](https://developers.home-assistant.io/docs/frontend/architecture/)
- [Home Assistant WebSocket API](https://www.home-assistant.io/integrations/websocket_api/)
- [Home Assistant REST and WebSocket APIs (DeepWiki)](https://deepwiki.com/home-assistant/developers.home-assistant/6.2-rest-and-websocket-apis)
- [Docker Architecture Overview - Spacelift](https://spacelift.io/blog/docker-architecture)
- [Docker Engine API Documentation](https://docs.docker.com/reference/api/engine/)
- [Backend-for-Frontend Pattern - AWS](https://aws.amazon.com/blogs/mobile/backends-for-frontends-pattern/)

### CLI-to-GUI Bridges and Accessibility
- [Lazygit: A Simple Terminal UI That Makes Git Human-Friendly](https://www.blog.brightcoding.dev/2025/08/14/lazygit-a-simple-terminal-ui-that-makes-git-human-friendly/)
- [K9s - Kubernetes CLI To Manage Your Clusters In Style](https://k9scli.io/)
- [Essential CLI/TUI Tools for Developers - freeCodeCamp](https://www.freecodecamp.org/news/essential-cli-tui-tools-for-developers/)

### Aigon Codebase (internal)
- Feature 41 spec: `docs/specs/features/05-done/feature-41-conductor-web-dashboard.md`
- Feature 39 spec: `docs/specs/features/03-in-progress/feature-39-conductor-menubar.md`
- Feature 33 spec: `docs/specs/features/05-done/feature-33-conductor-vscode.md`
- Feature 45 spec: `docs/specs/features/05-done/feature-45-aigon-radar.md`
- Research 06 findings: `docs/specs/research-topics/04-done/research-06-tmux-conductor.md`
- Radar implementation: `lib/utils.js` (runRadarServiceDaemon at line 1750+)
- Dashboard template: `templates/dashboard/index.html`
- VS Code extension: `vscode-extension/extension.js`

## Recommendation

### Strategic Assessment

Aigon already has the right architectural foundation. Radar is an API-first local service with multiple thin clients consuming it -- this mirrors the Home Assistant and Docker patterns, the most successful multi-client developer tool architectures.

The critical insight is that **the "web vs native" framing is less useful than the sequencing question**: what should be built first to learn the most while locking in the least?

### Recommended Sequence

**Phase 1 (Now): Web dashboard -> interactive operator console**

The web dashboard is the lowest-risk, highest-leverage bet:
- Feature 41 and Radar (feature 45) already exist and work
- Cross-platform by default; no macOS lock-in
- Railway ($100M Series B) validates browser-based operator consoles
- Vercel proves polling-first works; WebSocket is an incremental upgrade
- xterm.js + Radar WebSocket for terminal viewing is a proven pattern (Render, Proxmox)
- Read-only terminal streaming is sufficient for v1 (dramatically simpler than bidirectional)

Concrete next steps:
1. Add WebSocket support to Radar (state subscriptions + terminal streaming)
2. Make dashboard interactive (feature board controls, agent launch/stop)
3. Embed read-only terminal viewer (xterm.js) for active agent sessions
4. Add local bearer token auth before exposing mutation endpoints

**Phase 2 (After dashboard proves out): Enrich VS Code/Cursor extension**

The extension should be an 80/20 companion, not a second operator console:
- Surface 3-5 most common actions: view status, launch implementation, see agent output, jump to dashboard
- Follow the GitHub Desktop pattern: visual on-ramp, CLI/dashboard for advanced operations
- Keep scope deliberately limited to avoid IDE lock-in and Cursor compatibility risks

**Phase 3 (Evaluate based on demand, do not pre-commit): Native macOS app**

Only invest if Phases 1-2 validate the product model AND users consistently request ambient access without a browser:
- The menubar (feature 39) already provides ambient status monitoring
- A PWA version of the dashboard could partially address "without a browser" needs
- Native is highest cost (second codebase, signing/notarization, platform lock-in)

### Architectural Principle

**Radar is the control plane. Everything else is a view.**

All investment in Radar's API (WebSocket, richer endpoints, session streaming) benefits every client simultaneously. Investment in any single client has bounded impact. This ensures the architecture stays flexible as user needs evolve.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| radar-websocket-api | Add WebSocket support to Radar for real-time state subscriptions and terminal output streaming | high | none |
| radar-session-lifecycle | Extend Radar API with endpoints to start, stop, and monitor agent tmux sessions | high | none |
| dashboard-interactive-board | Add feature board manipulation (create, move, prioritise) and agent launch/stop controls to the web dashboard | high | radar-session-lifecycle |
| dashboard-terminal-viewer | Embed read-only terminal viewing via xterm.js for active agent sessions in the dashboard | high | radar-websocket-api |
| radar-local-auth | Implement local bearer token authentication for Radar API and dashboard mutation endpoints | medium | none |
| vscode-extension-actions | Extend VS Code/Cursor extension with common actions: launch implementation, view agent output, jump to dashboard | medium | radar-websocket-api |
| dashboard-pwa | Package the web dashboard as a Progressive Web App for installable ambient access | low | dashboard-interactive-board |
| radar-tmux-control-mode | Implement tmux control mode monitoring for real-time session telemetry and crash detection (from research-06) | low | radar-session-lifecycle |
