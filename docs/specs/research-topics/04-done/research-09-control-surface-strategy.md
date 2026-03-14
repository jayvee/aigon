# Research: control-surface-strategy

## Context
Aigon currently has the beginnings of multiple operator surfaces: a web dashboard, a menubar integration, and a VS Code extension, with Radar intended as the shared local service behind them. That direction is good for status visibility, but the product ambition is moving beyond monitoring.

The real target is an approachable control surface where a user can:

- see feature and agent state across repos
- create and prioritise work without remembering CLI commands
- move features across the board
- launch and manage implementations
- jump into or directly interact with live agent/tmux sessions
- eventually treat Aigon as the main operating environment for AI-assisted delivery

That raises a strategic question: should Aigon keep investing in the web dashboard as the primary rich interface, pivot now toward a native macOS app, lean on VS Code/Cursor as the host shell, or explicitly adopt a hybrid model where Radar is the control plane and multiple clients exist for different jobs?

This research is also motivated by product accessibility. Aigon currently assumes comfort with CLI workflows, slash commands, worktrees, and agent sessions. If the product is to become more approachable for users who are not deeply terminal-native, the control surface decision matters now.

## Questions to Answer
- [ ] What does the current web dashboard (feature 41) already support, and what is the concrete gap between its current state and a functional operator console?
- [ ] Can the web-based dashboard realistically evolve from a passive status board into an interactive operator console for Aigon?
- [ ] What are the engineering costs of making the web dashboard interactive — WebSocket infrastructure, state management, real-time sync with Radar, auth (even local)?
- [ ] Radar already has `POST /api/attach` for tmux sessions. What would it take to extend this into a full session transport (bidirectional I/O, latency requirements, session lifecycle handling)?
- [ ] Is read-only session viewing sufficient for a v1 embedded terminal, or is bidirectional input required to be useful?
- [ ] What product and engineering advantages would a native macOS app provide over a browser-based control surface?
- [ ] What would a macOS app cost in exchange: platform lock-in, sandbox/file-access complexity, release overhead, helper-process complexity, and maintenance burden?
- [ ] Could VS Code or Cursor serve as a transitional primary surface while the web console matures, given that Aigon users are already in these editors and the extension (feature 33) exists?
- [ ] Based on Aigon's current architecture, what sequence of bets best reduces risk while making the product easier for non-CLI-native users?
- [ ] Which responsibilities should belong to Radar versus the UI client, regardless of whether the client is web, native, or IDE-hosted?

## Scope

### In Scope
- The current Aigon architecture: Radar, dashboard, menubar, VS Code extension, workflow state under `docs/specs/`
- Web UI as an operator surface, not just a read-only dashboard
- Native macOS app as a future or current primary shell
- VS Code/Cursor extension or shell as an alternative operator surface
- tmux-backed session interaction and how that could surface in different clients
- Product accessibility for users who are not highly comfortable with CLI-first workflows
- A staged strategy recommendation, not just a static pros/cons list

### Out of Scope
- Implementing a native app
- Choosing a specific native framework in detail (`AppKit`, `SwiftUI`, `Tauri`, Electron wrapper, etc.)
- Windows/Linux desktop strategy
- Remote/cloud multi-user orchestration beyond the current local-first Aigon model
- Full design-system work for any future client

## Seed Notes

These are starting points for research, not conclusions. Agents should validate, challenge, or refine these.

- Aigon already has an API-first shape: Radar (feature 45) is one service with one API and multiple thin views. Relevant prior work: feature 41 (web dashboard), feature 39 (menubar), feature 33 (VS Code extension), research-06 (tmux conductor).
- Radar already exposes `POST /api/attach` for tmux session attachment — this is a starting point for the session transport question.
- The VS Code spec (feature 33) is intentionally conservative and read-mostly — worth investigating whether that was a deliberate scope choice or a limitation to revisit.
- The "web vs native" framing may be less useful than asking about sequencing: what should be built first to learn the most while locking in the least.

## Findings

All three agents (cc, gg, cx) converge on the same architectural principle: **Radar is the control plane, everything else is a view.** Investment in Radar's API benefits every client simultaneously, while investment in any single client has bounded impact.

### Consensus
- The web dashboard should evolve from passive status board into the primary interactive operator console for non-CLI-native workflows.
- Radar needs explicit mutation/action APIs — clients should stop relying on copied CLI commands.
- Read-only session viewing (xterm.js streaming tmux output) is the right v1; bidirectional terminal input is a Phase 2 concern.
- WebSocket or push-based event delivery should replace 10-second polling.
- A native macOS app should be deferred until the interaction model is proven and demand is validated.
- VS Code/Cursor extension should be enriched as a companion surface, not the primary console.

### Divergent Views
- **IDE-first vs web-first sequencing**: gg advocates making VS Code the primary interactive surface first (users are already there, native terminal avoids xterm.js complexity). cc and cx advocate web-first (lowest incremental cost, dashboard + Radar already exist, cross-platform, validated by Railway/Vercel).
- **Bidirectional terminal urgency**: gg argues read-only is insufficient even for v1 (users need to interrupt, resolve conflicts, enter inputs). cc and cx agree read-only is sufficient for v1 and recommend validating usage before investing in bidirectional transport.
- **VS Code role**: gg sees it as the primary operator surface; cc sees it as an 80/20 companion; cx sees it as a transitional power-user shell.

### Synthesis Decision
Adopt the web-first sequencing (cc/cx majority) with Radar as the shared control plane. The web dashboard becomes the primary operator console. VS Code/Cursor is enriched as a companion. Native is deferred.

## Recommendation

Adopt an explicit **hybrid control-surface strategy** with Radar as the single control plane:

1. **Phase 1**: Upgrade Radar with action APIs, session lifecycle management, and WebSocket event delivery.
2. **Phase 2**: Upgrade the web dashboard into a genuine operator console with board controls, agent management, and read-only terminal preview.
3. **Phase 3**: Enrich VS Code/Cursor extension with Radar-backed actions for common workflows.
4. **Phase 4**: Evaluate PWA packaging, tmux control mode, bidirectional sessions, and native shell based on validated demand.

This sequence reduces risk, improves accessibility quickly, and preserves optionality across web, native, and IDE clients.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| control-surface-radar-interactive-api | Add Radar action APIs (create, move, launch, stop, eval, submit) with session lifecycle management and WebSocket push for real-time state + terminal streaming | high | `aigon feature-create "control-surface-radar-interactive-api"` |
| control-surface-dashboard-operator-console | Upgrade dashboard with board controls, agent launch/stop, and read-only terminal preview (xterm.js) | high | `aigon feature-create "control-surface-dashboard-operator-console"` |
| control-surface-vscode-operator-actions | Extend VS Code/Cursor extension with Radar-backed actions (launch, eval, attach) | medium | `aigon feature-create "control-surface-vscode-operator-actions"` |
| control-surface-dashboard-pwa | Package web dashboard as a Progressive Web App for installable ambient access | low | `aigon feature-create "control-surface-dashboard-pwa"` |
| control-surface-radar-tmux-control-mode | Implement tmux control mode for real-time session telemetry and crash detection | low | `aigon feature-create "control-surface-radar-tmux-control-mode"` |
| control-surface-radar-session-stream | Add tmux-backed bidirectional session streaming with resize/reconnect | medium | `aigon feature-create "control-surface-radar-session-stream"` |
| control-surface-native-shell-spike | Prototype a thin macOS shell after Radar action model is stable | low | `aigon feature-create "control-surface-native-shell-spike"` |

### Feature Dependencies
- control-surface-dashboard-operator-console depends on control-surface-radar-interactive-api
- control-surface-vscode-operator-actions depends on control-surface-radar-interactive-api
- control-surface-dashboard-pwa depends on control-surface-dashboard-operator-console
- control-surface-radar-session-stream depends on control-surface-radar-interactive-api
- control-surface-native-shell-spike depends on control-surface-dashboard-operator-console

### Not Selected
- radar-local-auth: Overkill for single-user localhost tool at current stage
