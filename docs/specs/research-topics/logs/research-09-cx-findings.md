---
status: submitted
updated: 2026-03-13T09:05:54.219Z
---

# Research Findings: control surface strategy

**Agent:** Codex (cx)
**Research ID:** 09
**Date:** 2026-03-13

---

## Key Findings

### 1. Current state: the dashboard is useful, but it is not yet an operator console

- The current web dashboard already has a solid read model: multi-repo status aggregation, inferred next actions, filtering, waiting/error toasts, and per-agent `Attach` for running tmux sessions. The implementation is intentionally thin: the browser polls `GET /api/status` every 10 seconds and can `POST /api/attach` to open a native terminal attached to tmux. It does not currently create work, reprioritize work, move cards, launch agents, or stream terminal I/O.  
  Local evidence: `templates/dashboard/index.html`, `lib/utils.js`, and `docs/specs/features/logs/selected/feature-41-cx-conductor-web-dashboard-log.md`.

- `POST /api/attach` is an OS handoff, not a browser transport. Radar validates the session, then asks Terminal.app/iTerm2 to run `tmux attach -t <session>`. That means Aigon already knows how to discover sessions and attach to them, but the browser never becomes the terminal.  
  Local evidence: `lib/utils.js`.

- Concrete gap from “status board” to “functional operator console”:
  - add mutation endpoints for workflow actions (`create`, `prioritise`, `move`, `launch`, `eval`, `submit`)
  - replace inferred “copy this slash command” guidance with explicit Radar-backed actions
  - move from polling to push or near-real-time event delivery for live operation
  - add a session-preview or session-streaming layer if embedded terminal UX matters
  - add client/session auth even in local-first mode, because a writable terminal transport is materially more sensitive than status reads

### 2. The web dashboard can evolve into an interactive console, but only as part of a hybrid model

- Yes, the web surface can realistically become the primary rich console for board operations, triage, launch, and session discovery because Radar already gives Aigon an API-first backbone. The current repo shape strongly favors “Radar as control plane, multiple clients as views/controllers” rather than putting orchestration logic into each surface.

- The web should not be the only surface for all jobs yet. Browsers are excellent for dashboards, boards, forms, lists, notifications, and lightweight actions. They are workable but more expensive for terminal-grade interaction. The likely winning shape is:
  - web dashboard: primary operator console
  - native terminal/IDE attach: primary deep editing and intervention surface initially
  - menubar: ambient awareness and quick jumps
  - VS Code/Cursor: transitional shell for users already living in editor workflows

- This is also the best accessibility path for non-CLI-native users: let them operate from a browser for common actions, while preserving “open the real session” for advanced intervention instead of forcing terminal literacy up front.

### 3. Engineering cost of making the web dashboard interactive is moderate for board actions, high for embedded sessions

- Board-level interactivity is moderate cost:
  - Radar already owns state discovery and some side effects
  - the missing work is mostly explicit action APIs, state reconciliation, optimistic UI choices, and event delivery
  - current package shape is intentionally minimal and has no runtime dependencies in `package.json`, so even adding WebSocket/session infrastructure changes the deployment and maintenance profile

- Embedded terminal interactivity is high cost:
  - browser terminal UI: likely `xterm.js`
  - transport: persistent full-duplex channel, typically WebSocket
  - backend bridge: tmux-aware streaming and input relay, plus resize handling, reconnect, and backpressure
  - security: xterm.js explicitly warns not to ship the demo/attach addon as a production WebSocket solution
  - lifecycle: mapping browser tabs to long-lived tmux sessions, handling disconnect/reconnect, and deciding whether the browser is a viewer, the owner, or just another client

- Practical alternative paths:
  1. **No embedded terminal yet**: keep `Attach` opening the native terminal. Lowest cost, best leverage of current tmux model.
  2. **Read-only session peek**: stream recent pane output or live output without stdin. Good learning value, lower risk.
  3. **Full browser terminal**: highest capability, highest complexity, only justified once operator workflows outside the terminal are already working.

### 4. Extending `/api/attach` into full session transport is feasible, but tmux should remain the source of truth

- At least three implementation approaches exist:
  1. **tmux-backed transport**: keep tmux as the durable session owner, and bridge browser clients to tmux output/input. This fits Aigon best because tmux is already the canonical session primitive.
  2. **PTY-backed transport with `node-pty`**: create/manage processes directly from Radar and stream them to the browser. This is common in web terminals, but it duplicates lifecycle already handled by tmux and introduces native-module/runtime complexity.
  3. **Launch-only web control**: keep transport out of scope and use the browser to discover and open sessions elsewhere.

- Recommendation: if Aigon pursues browser terminals, do it tmux-first rather than PTY-first. Aigon already depends on tmux semantics, naming, resumability, and attach workflows. Replacing that with PTY-owned lifecycle would create two session models instead of one.

- Minimum requirements for a real session transport:
  - full-duplex channel with reconnect semantics
  - output streaming and input relay
  - terminal resize handling
  - session identity and authorization
  - lifecycle rules for attach/detach/garbage collection
  - contention policy when multiple clients are connected

### 5. Read-only session viewing is useful for v1, but insufficient as the end-state

- Read-only viewing is enough for a v1 **session peek** feature if the goal is:
  - confirm whether an agent is active or stuck
  - inspect the latest output before deciding to intervene
  - reduce unnecessary context-switching into terminal windows

- Read-only viewing is **not** enough if Aigon wants the control surface itself to feel complete. Once a user sees an embedded terminal pane, they will expect to type into it. Real operator value comes from closing the loop: observe, decide, act.

- The right sequencing is:
  1. ship read-only transcript/live preview
  2. validate whether users stay in the browser longer because of it
  3. only then decide whether writable embedded terminal interaction is worth the added transport/security burden

### 6. Native macOS app advantages are real, but the timing is wrong

- Product/engineering upsides of a native macOS shell:
  - stronger “main operating environment” feel than a browser tab
  - tighter windowing, notifications, menu bar, keyboard shortcuts, and session focus behavior
  - easier polished integration with local OS affordances
  - potentially better terminal-style UX and app-presence for non-CLI-native users

- Costs in exchange:
  - platform lock-in immediately narrows Aigon’s audience
  - file access becomes more complex if the app is sandboxed; Apple’s sandbox model relies on entitlements and security-scoped bookmarks for persistent access outside the app container
  - release/signing/distribution overhead increases materially compared with the current CLI + browser model
  - helper/background-process complexity remains, because Radar or something Radar-like still has to watch repos and own automation
  - maintenance burden grows because native UI becomes another first-class product, not just another thin client

- Conclusion: native macOS may become the premium shell later, but building it now would pull effort away from proving the control model itself. Aigon still needs to learn which operations belong in the control plane before it optimizes the shell around them.

### 7. VS Code/Cursor is the best transitional primary surface, but not the long-term whole product

- The existing VS Code extension already consumes Radar and gives users a familiar home base inside the editor. That makes it a strong transitional primary surface for current users because it reduces context-switching and leverages where they already spend time.

- Its limits are structural:
  - today it is mostly read-only and “copy slash command” oriented
  - editor sidebars are good for awareness and light actions, but less good as a broad multi-repo operator console
  - relying on IDEs as the main shell makes Aigon’s experience depend on another product’s UX, extension APIs, and distribution model

- Recommendation: use VS Code/Cursor to accelerate adoption and de-risk interaction design, but keep the architectural center in Radar so the same actions can later power web and native clients.

### 8. Radar should own control-plane responsibilities regardless of client

- Radar responsibilities:
  - repo/workflow discovery and state normalization
  - authoritative workflow mutations
  - session discovery, attach/detach, and eventual stream brokering
  - background automation such as notifications and auto-eval
  - event publication to clients
  - local auth/session policy for sensitive actions

- Client responsibilities:
  - render status and interaction affordances
  - collect user intent and call Radar actions
  - maintain local UI state only
  - optionally host client-specific affordances like browser board UX, IDE context actions, or menubar summaries

- This separation matches the current architecture and keeps Aigon from re-implementing orchestration logic three times.

### 9. Recommended sequence of bets

1. **Double down on Radar as the control plane.** Add explicit action APIs before building a more ambitious shell.
2. **Upgrade the web dashboard into an operator console for board/workflow actions.** This is the best accessibility win per unit of effort.
3. **Add read-only session preview in the web UI.** Learn whether browser-embedded visibility meaningfully reduces terminal hops.
4. **Use VS Code/Cursor as the transitional “power-user shell.”** Add richer editor actions where it materially helps current users.
5. **Delay a native macOS app until the interaction model is proven.** Build native later around validated control-plane operations, not before.

## Sources

- Local code and specs:
  - `templates/dashboard/index.html`
  - `lib/utils.js`
  - `vscode-extension/extension.js`
  - `docs/specs/features/logs/selected/feature-41-cx-conductor-web-dashboard-log.md`
  - `docs/specs/features/logs/selected/feature-39-conductor-menubar-log.md`
  - `docs/specs/features/logs/selected/feature-33-conductor-vscode-log.md`
  - `docs/specs/features/logs/selected/feature-45-cx-aigon-radar-log.md`
  - `docs/architecture.md`

- Primary / official external sources:
  - xterm.js security guide: https://xtermjs.org/docs/guides/security/
  - xterm.js project and addons: https://github.com/xtermjs/xterm.js
  - `node-pty` project: https://github.com/microsoft/node-pty
  - VS Code Tree View API: https://code.visualstudio.com/api/extension-guides/tree-view
  - VS Code task provider / `CustomExecution` / `Pseudoterminal`: https://code.visualstudio.com/api/extension-guides/task-provider
  - VS Code integrated terminal basics: https://code.visualstudio.com/docs/terminal/basics
  - VS Code shell integration: https://code.visualstudio.com/docs/terminal/shell-integration
  - Apple `startAccessingSecurityScopedResource()`: https://developer.apple.com/documentation/foundation/nsurl/startaccessingsecurityscopedresource%28%29
  - Apple App Sandbox entitlement reference: https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html

- Real-world reference implementations:
  - WeTTY: https://github.com/butlerx/wetty
  - ttyd: https://github.com/tsl0922/ttyd

## Recommendation

Adopt an explicit **hybrid control-surface strategy**:

- Keep **Radar** as the single control plane and source of truth.
- Make the **web dashboard** the primary rich operator console for non-terminal-native workflows: queue work, move work, launch work, inspect state, and decide what needs intervention.
- Treat **VS Code/Cursor** as the transitional power-user shell, not the final product shell.
- Keep **native terminal attach** as the primary intervention path until Aigon proves that browser-embedded session viewing materially changes behavior.
- Defer a **native macOS app** until the control model is validated and stable enough to deserve shell-specific investment.

Concretely, the next bet should not be “web vs native.” It should be:

1. add Radar action APIs
2. make the web dashboard genuinely operational for board/workflow actions
3. add read-only session preview
4. evaluate whether writable embedded sessions are worth the extra complexity

That sequence reduces risk, improves accessibility quickly, and preserves optionality across web, native, and IDE clients.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| radar-control-actions | Add authoritative Radar APIs for create, prioritise, move, launch, eval, and submit actions so clients stop relying on copied CLI commands. | high | none |
| radar-event-stream | Add push-based status/event delivery from Radar so operator surfaces do not depend on 10-second polling for live updates. | high | radar-control-actions |
| dashboard-operator-console | Upgrade the web dashboard from status-only triage to a true operator console with board actions and launch controls. | high | radar-control-actions |
| dashboard-session-peek | Add read-only embedded session preview in the web dashboard for live output inspection before attaching to tmux locally. | medium | radar-event-stream |
| vscode-radar-actions | Extend the VS Code extension with direct Radar-backed actions for common workflows such as launch, eval, and attach/focus. | medium | radar-control-actions |
| radar-session-stream | Add tmux-backed bidirectional session streaming with resize, reconnect, and authorization semantics for clients that need embedded terminal input. | medium | radar-event-stream |
| native-shell-spike | Prototype a thin macOS shell only after the Radar action model is stable, to validate whether native packaging materially improves operator UX. | low | dashboard-operator-console |
