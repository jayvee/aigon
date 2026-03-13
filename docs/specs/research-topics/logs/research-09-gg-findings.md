---
status: submitted
updated: 2026-03-13T09:00:35.504Z
---

# Research Findings: control surface strategy

**Agent:** Gemini (gg)
**Research ID:** 09
**Date:** 2026-03-13

---

## Key Findings

1. **Current State & Gaps (Web Dashboard - Feature 41)**
   The current web dashboard provides passive status monitoring. Evolving it to an interactive operator console is a substantial leap. It would require:
   - WebSocket infrastructure in Radar for real-time state sync.
   - Complex frontend state management (e.g., React/Vue) to handle optimistic updates and error states.
   - Integration of `xterm.js` or similar for terminal emulation.
   - Local authentication to prevent unauthorized execution via the browser.

2. **Terminal Interaction & `/api/attach`**
   Radar's current `POST /api/attach` handles tmux attachment, but for a web console, a read-only session is insufficient. Users need to interrupt processes (Ctrl+C), resolve git conflicts, or enter inputs. Building a robust bidirectional session transport over WebSockets with latency low enough for comfortable typing is a non-trivial engineering effort that distracts from core AI capabilities.

3. **Native macOS App**
   - **Pros:** Offers the best user experience with deep OS integration, native notifications, system tray presence, and robust native terminal support without browser sandbox limitations.
   - **Cons:** Introduces a massive engineering burden (SwiftUI/Tauri, XPC services, code signing, notarization, and update mechanics) and locks the product to a single platform prematurely.

4. **VS Code/Cursor (Feature 33) as Primary Surface**
   Aigon's users are already in the IDE. The IDE inherently provides robust, interactive terminal capabilities, file system access, and rich UI components without the need to reinvent them in a web browser. The current read-only nature of Feature 33 is a missed opportunity.

## Recommendation

**Adopt an IDE-First Control Plane Strategy with Radar as the Core Engine.**

Building a full-featured web terminal or a native macOS app at this stage is a high-risk, high-cost distraction. Instead, Aigon should sequence its bets to meet users where they already work while standardizing the underlying API:

1. **Phase 1 (IDE-First):** Evolve the VS Code extension from read-only to an interactive operator surface. Leverage VS Code's native terminal API to attach to tmux sessions and run commands directly, bypassing the need for web-based terminal emulation.
2. **Phase 2 (Radar Expansion):** Upgrade Radar (Feature 45) to expose state-mutating endpoints (`POST /api/features`, `POST /api/agents/launch`). This standardizes the control plane.
3. **Phase 3 (Web as Reporting):** Retain the web dashboard primarily for rich status reporting, cross-repo visibility, and lightweight interactions (like drag-and-drop prioritization), avoiding complex bidirectional terminal I/O in the browser.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| radar-mutations-api | Add state-mutating endpoints to Radar (e.g., create feature, launch agent) to standardise control operations. | high | feature-45-aigon-radar |
| vscode-operator-ui | Upgrade the VS Code extension to support feature creation, agent launching, and native terminal attachment. | high | radar-mutations-api |
| dashboard-interactive-prioritization | Add lightweight interactivity (e.g., drag-and-drop feature prioritization) to the web dashboard without full terminal emulation. | medium | radar-mutations-api |
| radar-websocket-status | Implement WebSocket-based real-time status syncing from Radar to replace aggressive polling in clients. | medium | feature-45-aigon-radar |