# Feature: macos-tmux-session-switcher

## Summary

A native macOS app (SwiftUI) that provides a fast, keyboard-driven interface for switching between Aigon tmux sessions. Instead of opening separate Terminal.app/iTerm2 windows per session (which all look identical), the app embeds a terminal emulator and lets you flick between sessions with keyboard shortcuts or a sidebar. Think of it as a purpose-built "Aigon Control Center" — one window, all your agent sessions, instantly switchable.

## User Stories

- [ ] As a user running multiple Fleet agents, I want to see all active tmux sessions in one place so I can quickly jump to the one I need
- [ ] As a user, I want to switch between sessions with a keyboard shortcut (e.g., Cmd+1..9 or Cmd+arrow) without hunting through identical "tmux" windows
- [ ] As a user, I want to see at a glance which feature/research ID and agent each session belongs to, with clear labels
- [ ] As a user, I want sessions to auto-discover — when Aigon creates new tmux sessions, they appear automatically
- [ ] As a user, I want to close/kill sessions from the app without needing the CLI

## Acceptance Criteria

- [ ] Native macOS app (SwiftUI + SwiftPM) builds and runs on macOS 14+
- [ ] App discovers all `aigon-*` tmux sessions automatically (polling or via conductor API)
- [ ] Sidebar or tab bar shows session list with parsed labels (e.g., "F14 claude", "R05 gemini")
- [ ] Selecting a session attaches to it in an embedded terminal view (using a terminal emulator library or `NSTask` + pseudo-terminal)
- [ ] Keyboard shortcuts: Cmd+1..9 for direct session access, Cmd+[ / Cmd+] for prev/next
- [ ] Sessions refresh on a short interval (2-5 seconds) or via filesystem/tmux event
- [ ] Color-coding or icons distinguish features vs research, and different agents
- [ ] App integrates with Aigon: `aigon config set tmuxApp aigon-switcher` makes Aigon open sessions in this app instead of Terminal.app/iTerm2

## Validation

```bash
# Build check
cd tools/tmux-switcher && swift build 2>&1 | tail -5
```

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────┐
│  macOS App (SwiftUI)                        │
│                                             │
│  ┌──────────┐  ┌──────────────────────────┐ │
│  │ Sidebar  │  │  Terminal View            │ │
│  │          │  │  (embedded pty)           │ │
│  │ F14 cc ● │  │                           │ │
│  │ F14 gg ○ │  │  $ claude                 │ │
│  │ R05 cc ● │  │  > working on feature...  │ │
│  │ R05 gg ● │  │                           │ │
│  │          │  │                           │ │
│  └──────────┘  └──────────────────────────┘ │
│                                             │
│  [Cmd+1] [Cmd+2] [Cmd+3] [Cmd+4]          │
└─────────────────────────────────────────────┘
```

### Key Technical Decisions

1. **Terminal emulation**: Use [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) — a mature Swift terminal emulator that supports PTY, ANSI escape codes, and can be embedded in SwiftUI via `NSViewRepresentable`. This avoids reinventing terminal rendering.

2. **Session discovery**: Run `tmux list-sessions -F '#{session_name} #{session_activity}'` on a 3-second timer. Filter for `aigon-*` prefix. Parse into structured data:
   - `aigon-f{id}-{agent}` → Feature #{id}, agent: {agent}
   - `aigon-r{id}-{agent}` → Research #{id}, agent: {agent}

3. **Session attachment**: Instead of `tmux attach`, use `tmux -CC attach -t {session}` (control mode) or spawn `tmux attach -t {session}` inside a PTY connected to SwiftTerm. The PTY approach is simpler and more reliable.

4. **One session at a time**: Only one session is "attached" (visible) at a time. Switching detaches the current and attaches the new one. This avoids the duplicate-window problem entirely.

5. **Aigon integration**: Add `aigon-switcher` as a `tmuxApp` option. When set, `openTerminalAppWithCommand` would either:
   - Send a deep link / XPC message to the running app, or
   - Write to a known socket/file that the app watches

### Project Structure

```
tools/tmux-switcher/
├── Package.swift
├── Sources/
│   └── AigonSwitcher/
│       ├── App.swift                 # @main entry point
│       ├── Models/
│       │   └── TmuxSession.swift     # Session model + discovery
│       ├── Views/
│       │   ├── ContentView.swift     # Main layout (sidebar + terminal)
│       │   ├── SessionSidebar.swift  # Session list with labels
│       │   └── TerminalView.swift    # SwiftTerm wrapper
│       └── Services/
│           └── SessionManager.swift  # tmux interaction, polling, attach/detach
└── README.md
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+1..9 | Switch to session by index |
| Cmd+[ / Cmd+] | Previous / next session |
| Cmd+K | Kill current session |
| Cmd+R | Refresh session list |
| Cmd+W | Detach (but don't kill) current session |

## Dependencies

- macOS 14+ (Sonoma) for latest SwiftUI features
- [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) — terminal emulator library
- tmux installed and on PATH
- Aigon tmux sessions following the `aigon-*` naming convention

## Out of Scope

- Windows/Linux support (macOS-only native app)
- Full IDE features (file editing, git integration) — this is a session viewer only
- Replacing tmux itself — the app is a frontend for existing tmux sessions
- Conductor dashboard replacement — this complements the web dashboard, doesn't replace it
- Session creation (use `aigon feature-setup` / `aigon research-setup` for that)

## Open Questions

- Should the app support tmux control mode (`-CC`) for tighter integration, or stick with PTY-based attach for simplicity?
- Should it show session output previews (last few lines) in the sidebar for quick scanning?
- Should it integrate with the conductor API (`/api/status`) for richer metadata (feature names, agent status)?
- Distribution: should this be a standalone `.app` bundle, or built/run via `swift run` from the Aigon repo?

## Related

- Feature: tmux session title fix (committed — `set-titles on` with `#{session_name}`)
- Existing code: `lib/utils.js` — `createDetachedTmuxSession`, `openTerminalAppWithCommand`, `buildTmuxSessionName`
- Existing code: `lib/utils.js` — conductor `/api/attach` endpoint
- External: [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) terminal emulator
