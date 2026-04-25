---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T00:07:02.424Z", actor: "cli/research-prioritise" }
---

# Research: terminal-in-dashboard

## Context

Today the dashboard can attach to a running tmux session and show its contents, but the interaction model is weak — it is not comparable to running Claude Code (or any other interactive CLI agent) inside a real terminal emulator like iTerm2. Keystrokes, paste, scrollback, resize, colour, and mouse behaviour all fall short of what a user gets from tmux-in-iTerm.

The user wants to investigate whether Aigon can ship a **browser-native terminal** that runs tmux inside the dashboard itself, removing the need for iTerm (or any external terminal) for day-to-day agent driving. The trigger for this research is [vercel-labs/wterm](https://github.com/vercel-labs/wterm), which appears to be a web terminal implementation that might be a suitable foundation — but the scope is broader than wterm specifically: any library, pattern, or architecture that achieves parity is in scope.

The end-state to aim for: a user can open the Aigon dashboard, click into an agent session, and interact with tmux/Claude Code there with **exactly the same fidelity** as iTerm+tmux — input latency, rendering, scrollback, copy/paste, resize, 24-bit colour, mouse reporting, and reliability across long-running sessions.

## Questions to Answer

- [ ] What is [wterm](https://github.com/vercel-labs/wterm)? How does it work (architecture, transport, rendering), what is its maturity, licence, and maintenance status, and is it production-ready for our use case?
- [ ] What are the credible alternatives (xterm.js + a PTY bridge, ttyd, wetty, gotty, Warp's terminal component, SSH-over-WebSocket front-ends, others)? For each: architecture, maturity, licence, footprint, and fit for embedding in Aigon's dashboard.
- [ ] What is the gap between today's dashboard-attach view and true tmux-in-iTerm parity? Enumerate the specific missing capabilities (input handling, 24-bit colour, mouse, resize, scrollback, bracketed paste, OSC 52 copy, unicode/emoji width, keybinding passthrough including Cmd/Opt, alternate screen buffer behaviour, latency under load).
- [ ] What is the right backend architecture to run tmux per user session for the browser terminal? Options include: attach-to-existing tmux sessions (current worktree model) vs. spawn-new-per-tab; PTY host process; WebSocket vs. SSE vs. long-poll transport; auth model; multi-tab/multi-client reattach semantics.
- [ ] How does the solution integrate with Aigon's existing session model (worktrees, Fleet, agent lifecycle, `aigon sessions-close`)? Does it replace the tmux attach panel, supplement it, or only apply to new-style sessions?
- [ ] What are the security implications of serving a browser terminal that can spawn/attach to local shells? Local-only bind, CSRF/WebSocket-origin checks, process isolation, auth tokens, risk of sharing the dashboard URL.
- [ ] Performance: what input latency, render throughput, and memory profile should we expect for a long-running Claude Code session with heavy output (e.g. code review diffs)? What are the limits of the candidate libraries?
- [ ] Cross-platform reality check: does the chosen approach work equally on macOS, Linux (Docker), and inside Warp/other browsers? Any Safari/Chromium-specific caveats?
- [ ] What is the minimum viable first slice? (e.g. one read/write terminal panel in the dashboard, backed by a single tmux attach, no multiplexing UI changes.) What does a staged rollout look like from MVP → iTerm parity → iTerm replacement?
- [ ] Is this a "remove iTerm entirely" play or a "dashboard becomes a first-class option alongside iTerm" play? What does the user flow look like in each case, and which is the right product bet?

## Scope

### In Scope
- Evaluating wterm and comparable browser-terminal libraries (xterm.js-based and otherwise).
- Backend architectures for bridging a browser terminal to host tmux sessions (PTY host, transport, auth).
- Feature-parity analysis vs. tmux-in-iTerm.
- Integration surface with existing Aigon session/worktree/Fleet model.
- Security model for a local-dev dashboard terminal.
- Recommending a concrete first-slice feature (or set of features) and a path to parity.

### Out of Scope
- Actually implementing the terminal (that is a follow-up feature).
- Replacing tmux itself — tmux remains the multiplexer; this is only about the frontend terminal.
- Remote/hosted-dashboard scenarios (Aigon is local-first; revisit if/when we ship hosted).
- Rewriting the existing tmux attach panel unless the research explicitly recommends it.
- Mobile/tablet terminal UX.

## Inspiration / Starting Points
- [vercel-labs/wterm](https://github.com/vercel-labs/wterm) — user-supplied starting reference.
- xterm.js (the underlying renderer most web terminals use).
- Memory: `feedback_iterm2_tabs_not_windows.md` — prior constraint was tabs over cmux/tmux -CC; this research may relax that by removing iTerm from the loop entirely.
- Memory: `project_dashboard_always_on.md` — dashboard is the daily command center, so a terminal there is aligned with product direction.

## Findings
<!-- Populated during research-do -->

## Recommendation
<!-- Populated during research-do -->

## Output
- [ ] Feature:
