# Research Findings: tmux conductor

**Agent:** Claude (cc)
**Research ID:** 06
**Date:** 2026-02-28

---

## 1. tmux capture-pane: Performance, Limits, and Behavior

### How It Works
`tmux capture-pane` extracts the content of a tmux pane into a paste buffer or directly to stdout (with `-p`). It is the primary mechanism for programmatically reading what's visible in a tmux pane.

### Key Flags
| Flag | Effect |
|------|--------|
| `-p` | Print to stdout instead of paste buffer |
| `-S N` / `-E N` | Start/end line numbers; `-S -` = start of history, `-E -` = end of content |
| `-J` | Join wrapped lines (adds trailing spaces) |
| `-e` | Include ANSI escape sequences (colors, attributes) |
| `-C` | Escape non-printable characters as octal `\xxx` (binary-safe) |
| `-N` | Preserve trailing spaces at line ends |

### Scrollback Buffer Limits
- **Default:** 2,000 lines per pane (`history-limit` option)
- **Practical maximum:** 10,000-50,000 lines is the sweet spot for utility vs. resource cost
- **Theoretical maximum:** No hard cap; users have set 50,000,000 lines, but this causes severe problems
- **Memory per line:** Approximately 200 bytes per line under normal conditions, so 50,000 lines ~= 10 MB per pane. However, this grows significantly with wide lines, truecolor/RGB escape sequences, and rapid redraws
- **Real-world memory issue:** One user with 50,000-line history heavy with RGB truecolor consumed 1.6 GB; after tmux optimization it dropped to 170 MB (tmux issue #4859)

### Performance Gotchas
- **Rapid redraws:** When a process rewrites the screen frequently (e.g., progress bars, Codex CLI bugs emitting 78KB/sec of redrawn characters), tmux can balloon to 48 GB virtual memory even with only ~1,000 lines of actual scrollback (issue #4859)
- **Status bar subshells:** If tmux's status bar contains subshell commands (`#(command ...)`), performance degrades proportionally to scrollback size; at ~40M lines tmux hits 100% CPU and becomes unusable (issue #3352)
- **Pane resize lag:** Resizing panes with accumulated history takes 2-15 seconds (issue #4171)

### Long Lines and Binary Output
- Lines are wrapped at screen width by default; `-J` joins them but adds trailing spaces
- No built-in "unwrap to original line" — this is a known limitation (issue #2688)
- The `-C` flag handles binary output by escaping non-printable characters as octal

### Recommendation for Aigon
For monitoring agent output, capture the last 20-50 lines with `tmux capture-pane -p -S -50` at a poll interval of 0.3-1.0 seconds. Set `history-limit` to 10,000-20,000 lines. Avoid very large buffers. For complete logs, use `pipe-pane` to write all output to a file in parallel.

### Sources
- [tmux Advanced Use Wiki](https://github.com/tmux/tmux/wiki/Advanced-Use)
- [tmux scrollback buffer practice](https://www.freecodecamp.org/news/tmux-in-practice-scrollback-buffer-47d5ffa71c93/)
- [ExpertBeacon: tmux scrollback buffer](https://expertbeacon.com/tmux-in-practice-scrollback-buffer/)
- [tmux issue #4859: memory usage per pane](https://github.com/tmux/tmux/issues/4859)
- [tmux issue #3352: scrollback + status subshell performance](https://github.com/tmux/tmux/issues/3352)
- [tmux issue #4171: resize lag with history](https://github.com/tmux/tmux/issues/4171)
- [tmux issue #2688: line wrapping on save](https://github.com/tmux/tmux/issues/2688)
- [tmux issue #3279: capture-pane -J trailing space](https://github.com/tmux/tmux/issues/3279)

---

## 2. tmux send-keys with Interactive CLI Tools

### Can tmux send-keys Interact with Claude Code's Prompts?

**Yes, but with important caveats.** The `claude-yolo` project has proven this works in production.

### How Permission Approval Works
- Claude Code pre-selects the affirmative option (`> 1. Yes`), so **sending `Enter` is the approval mechanism** — not `y` or `yes`
- Sending `y` via `tmux send-keys` does nothing; only `Enter` works
- Format: `tmux send-keys -t SESSION:WINDOW.PANE Enter`

### Detection Strategy (from claude-yolo)
The approver daemon captures the last 20 lines of each pane every 0.3 seconds and uses two-tier pattern matching:
1. **Primary signal:** Presence of `Allow`/`Deny` buttons OR numbered options like `1. Yes / 2. No`
2. **Secondary signal (at least one required):** Tool keywords (`Bash`, `WebFetch`, `Read`, `Write`, `Edit`) or context phrases (`want to proceed`, `permission`, `allow once`)

Simple keyword matching alone produces too many false positives from code output and markdown.

### Collapsed Transcript Problem
When Claude Code's transcript is toggled off, prompts aren't visible in capture-pane output. Solution: detect collapsed state, send `Ctrl+O` to expand transcript, then approve on the next poll cycle.

### Timing and Race Conditions
- **Escape key timing:** tmux uses `escape-time` (default 500ms) to distinguish between a bare Escape key and the start of an escape sequence. This matters for vi-mode interactions
- **Control key race conditions:** `Ctrl-Z` and similar control keys can cause race conditions with shell job control. Workaround: insert short sleeps (a few milliseconds) before and after critical control keys
- **Double-approval prevention:** A 2-second per-pane cooldown prevents the 0.3s poll interval from sending multiple Enter keystrokes for the same prompt

### Alternative: --dangerously-skip-permissions
Claude Code's `--dangerously-skip-permissions` flag bypasses all permission prompts. However:
- Only recommended in isolated environments (Docker, CI/CD)
- `--allowedTools` may be ignored in bypass mode (known bug)
- `--disallowedTools` works correctly even in bypass mode

### Sources
- [claude-yolo: tmux auto-approval for Claude Code](https://github.com/claude-yolo/claude-yolo)
- [tmux send-keys FAQ](https://github.com/tmux/tmux/wiki/FAQ)
- [tmux escape key timing discussion](https://github.com/orgs/tmux/discussions/4482)
- [tmux issue #3360: Ctrl-Z race conditions](https://github.com/tmux/tmux/issues/3360)
- [tmux send-keys Enter issue #1778](https://github.com/tmux/tmux/issues/1778)
- [claude --dangerously-skip-permissions guide](https://blog.promptlayer.com/claude-dangerously-skip-permissions/)
- [Claude Code permissions documentation](https://code.claude.com/docs/en/permissions)

---

## 3. Performance Overhead: Concurrent tmux Sessions

### Memory
- **tmux server process:** ~135 MB RSS with 8 windows and 10,000-line history-limit (compared to GNU Screen's ~46 MB with 39 windows and 5,000-line scrollback)
- **With history-limit 0:** tmux uses less memory than Screen
- **Memory doesn't return:** On Linux, glibc's memory allocator may not return freed memory to the OS. One user saw a tmux process grow to 1.85 GB RSS after 3 months of continuous use
- **Per-pane cost:** Roughly 200 bytes/line * history-limit * number_of_panes. With 6 panes at 10,000 lines each: ~12 MB for scrollback alone, plus overhead

### CPU
- **Idle sessions:** Near-zero CPU when panes are not producing output
- **Active output:** CPU grows with output volume. With 5 active panes: ~2.3% CPU baseline
- **High-volume output:** When panes produce heavy output (progress bars, streaming logs), tmux can spike. Avoid status bar subshells (`#(...)`) to prevent O(n) CPU scaling with scrollback size
- **Polling overhead:** `capture-pane -p` every 0.3 seconds across 6 panes is negligible — tmux commands complete in <1ms typically

### Practical Assessment for 4-6 Concurrent Agent Sessions
Running 4-6 Claude Code/Gemini/Codex agents in tmux panes is well within normal tmux usage. The agents themselves (LLM API calls, file I/O, subprocess execution) will dominate resource usage. tmux overhead is negligible by comparison. Key recommendations:
- Set `history-limit` to 10,000-20,000 (not more)
- Avoid status bar subshells
- Use `pipe-pane` to log to files rather than relying on massive scrollback
- Monitor for the glibc memory-not-freed issue on long-running sessions

### Sources
- [tmux memory usage on Linux (blog.42.be)](https://blog.42.be/2015/02/tmux-memory-usage-on-linux.html)
- [tmux issue #706: heavy memory usage](https://github.com/tmux/tmux/issues/706)
- [tmux issue #3194: high memory and input lag](https://github.com/tmux/tmux/issues/3194)
- [tmux issue #1167: memory growth over time](https://github.com/tmux/tmux/issues/1167)

---

## 4. Alternatives to tmux

### 4a. GNU Screen

| Criterion | Assessment |
|-----------|------------|
| Scriptability | Custom scripting language (C-like). Less composable than tmux's shell-friendly command model |
| Programmatic control | `screen -X` sends commands, but less structured than tmux's target system (`-t session:window.pane`) |
| Session persistence | Yes — detach/reattach works the same as tmux |
| Output monitoring | `screen -X hardcopy` captures screen content to file. No equivalent of `capture-pane -p` piping to stdout |
| Capture quality | Less flexible than tmux's capture-pane flags (-J, -e, -C, -N) |
| Memory efficiency | More memory-efficient than tmux for many windows (~46 MB for 39 windows vs tmux's ~135 MB for 8 windows) |
| Community/ecosystem | Mature but stagnant; tmux has more active development and plugin ecosystem |

**Verdict:** Screen's scripting interface is inferior for programmatic orchestration. tmux's `-t` targeting, `capture-pane -p`, and `pipe-pane` make it clearly better for Aigon's use case.

### 4b. Zellij

| Criterion | Assessment |
|-----------|------------|
| Scriptability | CLI actions (`zellij action`, `zellij run`) for pane/window management |
| Programmatic control | `zellij run` creates panes with commands; plugins use WebAssembly for deep customization |
| Session persistence | Built-in session manager with session resurrection |
| Output monitoring | Plugins can run commands and receive output via `RunCommandResult` events |
| Capture quality | No direct equivalent of `capture-pane -p`; plugins capture output through event callbacks |
| Plugin system | WebAssembly plugins — any language that compiles to Wasm. More structured than tmux's shell-based approach |
| Ecosystem maturity | Younger than tmux; fewer third-party tools and less battle-tested for scripting |

**Pros over tmux:**
- Modern design, built-in layouts, floating panes
- WebAssembly plugin system allows richer programmatic interaction
- Better built-in session management

**Cons vs tmux:**
- More prescriptive — harder to compose with external tools like fzf
- No `capture-pane -p` equivalent for simple shell-script monitoring
- Less ecosystem tooling (no libtmux equivalent, fewer automation recipes)
- Requires learning a different paradigm

**Verdict:** Zellij's WebAssembly plugin system is interesting for deeper integration, but for Aigon's "launch processes, poll output, send input" use case, tmux's simpler shell-based model is a better fit. Zellij would be more appropriate if we were building a full TUI dashboard as a Zellij plugin.

### 4c. abduco + dvtm

| Criterion | Assessment |
|-----------|------------|
| Scriptability | Minimal — abduco does session management only; dvtm does tiling only |
| Programmatic control | Very limited; no equivalent of tmux's command system |
| Session persistence | abduco provides detach/reattach |
| Output monitoring | No built-in capture mechanism |

**Verdict:** Too minimal for orchestration needs. The split architecture (session vs. tiling as separate tools) is elegant in theory but provides no scripting or monitoring capabilities.

### 4d. Pure PTY Capture (node-pty)

| Criterion | Assessment |
|-----------|------------|
| Scriptability | Full Node.js API — `pty.spawn()`, `onData()`, `write()` |
| Programmatic control | Complete control: spawn processes, send input, capture all output in real-time |
| Session persistence | **None** — if the Node.js process dies, the PTY processes are lost |
| Output monitoring | Real-time via `onData()` callback — no polling needed, no scrollback limits |
| Binary/escape handling | Raw terminal output; must handle escape sequences yourself |
| Platform support | Linux, macOS, Windows (via conpty on Win 1809+) |
| Dependencies | Native module requiring node-gyp compilation |

**Pros over tmux:**
- No external dependency (tmux binary not required)
- Real-time output streaming without polling
- Complete control over process lifecycle from Node.js
- No scrollback buffer limits

**Cons vs tmux:**
- No session persistence — cannot detach/reattach
- Must implement your own output buffering and history
- Must handle terminal escape sequences manually (or use xterm.js)
- Native module build dependency (node-gyp)
- Cannot "jump in" to a session from another terminal

**Verdict:** node-pty gives maximum programmatic control and is ideal for a headless-only orchestrator that never needs human attachment. But Aigon specifically wants "headless by default, attachable on demand" — which is exactly what tmux provides and node-pty cannot. node-pty could be useful as a fallback for environments where tmux is unavailable.

### 4e. Background Processes with File Redirection

| Criterion | Assessment |
|-----------|------------|
| Scriptability | Standard Unix — `nohup`, `&`, `>`, `tee` |
| Programmatic control | `kill`, `wait`, signal handling. No input mechanism once process starts |
| Session persistence | `nohup` survives terminal close; but no reattach capability |
| Output monitoring | `tail -f logfile` works well; `tail -F` handles log rotation |

**Pros:**
- Zero dependencies — works everywhere
- Simple, predictable behavior
- Easy to implement log rotation and archival

**Cons:**
- **No input mechanism** — cannot send keystrokes to a background process
- No TTY — interactive tools like Claude Code may behave differently without a PTY
- No "jump in" capability
- Cannot approve permission prompts

**Verdict:** This is the approach in the current conductor spec (`spawn()` with detached processes + status files). It works for `--print` mode / headless SDK usage, but cannot support interactive Claude Code sessions. The tmux approach is a strict superset of this.

### Summary Table

| Alternative | Scriptability | Session Persist | Output Capture | Input Sending | Human Attach | Aigon Fit |
|------------|--------------|-----------------|----------------|---------------|-------------|-----------|
| **tmux** | Excellent | Yes | capture-pane, pipe-pane | send-keys | tmux attach | Best |
| GNU Screen | Good | Yes | hardcopy (limited) | stuff command | screen -r | Acceptable |
| Zellij | Good (Wasm plugins) | Yes | Plugin events | Plugin events | zellij attach | Overkill |
| abduco+dvtm | Minimal | Yes (abduco) | None | None | abduco attach | Insufficient |
| node-pty | Excellent (Node API) | No | Real-time events | write() | No | Headless only |
| Background+files | Basic | Partial (nohup) | tail -f | No | No | --print mode only |

### Sources
- [Slant: tmux vs abduco+dvtm comparison](https://www.slant.co/versus/11858/11860/~tmux_vs_abduco-dvtm)
- [abduco ArchWiki](https://wiki.archlinux.org/title/Abduco)
- [node-pty GitHub (Microsoft)](https://github.com/microsoft/node-pty)
- [stmux: Node.js terminal multiplexer using node-pty](https://github.com/rse/stmux)
- [Zellij CLI actions documentation](https://zellij.dev/documentation/cli-actions)
- [Zellij plugin API commands](https://zellij.dev/documentation/plugin-api-commands.html)
- [tmux vs Zellij comparison (dasroot.net)](https://dasroot.net/posts/2026/02/terminal-multiplexers-tmux-vs-zellij-comparison/)
- [Keyhole Software: Zellij impressions](https://keyholesoftware.com/zellij-the-impressions-of-a-casual-tmux-user/)
- [nohup vs screen vs tmux comparison](https://gist.github.com/MangaD/632e8f5a6649c9b2e30e2e5d3926447b)

---

## 5. Warp Terminal API and Programmatic Control

### What Warp Provides

**URI Scheme (local terminal control):**
- `warp://action/new_window?path=<path>` — opens a new Warp window
- `warp://action/new_tab?path=<path>` — opens a new tab
- `warp://launch/<config_path>` — opens a launch configuration
- **Limitation:** URI scheme cannot pass commands to execute. It can only open windows/tabs/configs at a directory.

**Launch Configurations (YAML files):**
- Stored in `~/.warp/launch_configurations/` (macOS)
- Support: tabs, panes, split directions, working directories, commands (via `exec:`)
- Commands execute on startup using `&&` chaining
- Can be triggered from Command Palette, menu, keyboard shortcuts
- **Limitation:** Dynamic programmatic creation is buggy — files written to the config directory may not appear in Warp's UI (issue #3780)

**Warp Platform Agent API (cloud-based, separate from desktop terminal):**
- REST API for creating/inspecting "Ambient Agent" tasks over HTTP
- Python and TypeScript SDKs wrapping the API
- Task lifecycle: create task with prompt + config, monitor state transitions (queued -> in progress -> succeeded/failed)
- **This is NOT local terminal control** — it's Warp's cloud agent product, unrelated to controlling desktop terminal tabs

### What Warp Does NOT Provide
- No CLI command to open a tab and run a command in it
- No API to read content from existing tabs/panes
- No programmatic equivalent of `tmux capture-pane` or `tmux send-keys`
- No way to interact with a running process in a Warp tab from another process
- The desktop terminal app and the Warp Platform Agent API are entirely separate systems

### Open Feature Requests
- [Issue #3959](https://github.com/warpdotdev/Warp/issues/3959): "Ability to open new tab and execute command from command line" — Open, no resolution
- [Issue #1074](https://github.com/warpdotdev/Warp/issues/1074): "Programmatically Open New Tab" — Open
- [Issue #5859](https://github.com/warpdotdev/Warp/issues/5859): "Execute commands in new window/tab through URI scheme" — Open
- [Discussion #612](https://github.com/warpdotdev/Warp/discussions/612): "Warp CLI + General Scriptability" — Long-running discussion, no resolution

### Verdict
Warp cannot replace tmux for Aigon's orchestration needs. The desktop terminal has no programmatic control API beyond basic "open tab at directory." The Warp Platform Agent API is a different product entirely (cloud-based agent orchestration). Aigon should use tmux for session management and optionally allow Warp as the terminal emulator that users manually open to `tmux attach`.

### Sources
- [Warp URI Scheme docs](https://docs.warp.dev/terminal/more-features/uri-scheme)
- [Warp Launch Configurations docs](https://docs.warp.dev/terminal/sessions/launch-configurations)
- [Warp issue #3780: programmatic launch config creation broken](https://github.com/warpdotdev/Warp/issues/3780)
- [Warp issue #3959: execute command in new tab](https://github.com/warpdotdev/Warp/issues/3959)
- [Warp issue #1074: programmatic tab creation](https://github.com/warpdotdev/Warp/issues/1074)
- [Warp issue #5859: commands via URI scheme](https://github.com/warpdotdev/Warp/issues/5859)
- [Warp Discussion #612: CLI scriptability](https://github.com/warpdotdev/Warp/discussions/612)

---

## 6. Claude Code's Non-Interactive Modes vs. Interactive tmux

### Available Modes

**`claude -p` (print/headless mode):**
- Single prompt in, result out, exit
- Output formats: `text` (default), `json` (structured with session_id, metadata), `stream-json` (NDJSON for real-time streaming)
- Permission handling: `--allowedTools "Read,Edit,Bash"` auto-approves specific tools
- Cost control: `--max-turns N` limits conversation turns; `--maxBudgetUsd N` limits spend
- Can pipe stdin: `cat file.py | claude -p "review this"`

**Session continuity (`--continue` and `--resume`):**
- `--continue` resumes the most recent conversation
- `--resume <session_id>` resumes a specific session
- Session IDs returned in `json` output format: `jq -r '.session_id'`
- Each session retains up to 200,000 tokens (~150,000 words) of context

**`--output-format stream-json` for real-time monitoring:**
- Emits NDJSON with every token, turn, and tool interaction
- Combined with `--verbose --include-partial-messages` for maximum visibility
- Can filter with jq: `jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'`

**Agent SDK (TypeScript and Python):**
- `import { query } from "@anthropic-ai/claude-agent-sdk"`
- Full programmatic control: `query({ prompt, options })` returns an `AsyncGenerator<SDKMessage>`
- **`canUseTool` callback:** Programmatic permission approval without tmux scraping
- **Session management:** `resume`, `continue`, `forkSession` options
- **Multi-turn:** `streamInput()` method for ongoing conversation
- **Abort/interrupt:** `AbortController` support, `query.interrupt()`, `query.close()`
- **Custom process spawning:** `spawnClaudeCodeProcess` option for VMs/containers

### Head-to-Head: SDK vs. Interactive-in-tmux

| Aspect | Agent SDK (headless) | Interactive in tmux |
|--------|---------------------|-------------------|
| Permission handling | `canUseTool` callback — clean, programmatic | `capture-pane` + pattern matching + `send-keys Enter` — fragile |
| Output monitoring | Native streaming via AsyncGenerator | Poll `capture-pane` every 0.3-1.0s |
| Session persistence | `--resume session_id` rebuilds context | tmux session persists with full terminal state |
| Human intervention | Must implement custom input mechanism | `tmux attach` — instant, full interactive access |
| Multi-turn conversation | `streamInput()` or sequential `--resume` calls | Natural — just type in the pane |
| Process survival | Tied to orchestrator process | tmux sessions survive orchestrator crash |
| Visual state | No terminal UI; logs only | Full Claude Code TUI visible on attach |
| Complexity | Moderate (SDK API, message parsing) | Low (shell commands, simple patterns) |
| Token overhead | Multi-turn consumes 30-50% more tokens vs isolated calls | Same token usage as manual interactive |
| Skills/commands | No access to `/commit`, `/review` etc. | Full access to all interactive features |

### Recommendation for Aigon
The Agent SDK is the superior approach for the conductor's programmatic needs:
- `canUseTool` eliminates the fragile capture-pane + pattern-matching approval loop
- Structured streaming output is more reliable than screen-scraping
- Session resume allows crash recovery without tmux dependency

However, tmux still has value as the "human escape hatch":
- When the SDK-based conductor detects a problem, it can spawn a tmux session for human intervention
- The `--resume` flag means a human can pick up an SDK session in interactive mode
- tmux provides the "jump in" capability that pure SDK mode lacks

**Recommended architecture: SDK-first with tmux as fallback for human intervention.**

### Sources
- [Claude Code headless mode documentation](https://code.claude.com/docs/en/headless)
- [Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK Python reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [Agent SDK permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Agent SDK user input/approvals](https://platform.claude.com/docs/en/agent-sdk/user-input)
- [SFEIR: Claude Code headless FAQ](https://institute.sfeir.com/en/claude-code/claude-code-headless-mode-and-ci-cd/faq/)
- [Stream-JSON chaining patterns (claude-flow wiki)](https://github.com/ruvnet/claude-flow/wiki/Stream-Chaining)
- [Multi-agent orchestration patterns](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da)

---

## 7. Nested tmux: Handling $TMUX Conflicts

### The Problem
When a user is already inside a tmux session and Aigon tries to create new tmux sessions, tmux refuses with: `sessions should be nested with care, unset $TMUX to force`

The `$TMUX` variable contains the socket path: e.g., `/tmp/tmux-1000/default,2003,0`

### Solutions (Ranked by Preference)

**1. Use a separate tmux server with `-L` (BEST APPROACH)**
```bash
# Aigon creates its own independent tmux server
tmux -L aigon new-session -d -s agent-1 "claude -p '...'"
tmux -L aigon new-session -d -s agent-2 "claude -p '...'"

# Monitor Aigon's sessions without touching user's tmux
tmux -L aigon capture-pane -t agent-1 -p

# User can attach to an Aigon session
tmux -L aigon attach -t agent-1
```

The `-L aigon` flag creates a completely independent tmux server with its own socket at `/tmp/tmux-$UID/aigon`. This server is isolated from the user's default tmux server. No `$TMUX` conflicts, no nested session warnings, no interference with the user's workflow.

**2. Temporarily unset $TMUX**
```bash
TMUX='' tmux new-session -d -s aigon-agent-1 "command"
```
This works but creates sessions on the same tmux server, which means they show up in the user's `tmux list-sessions` and could be accidentally killed.

**3. Use `tmux switch-client` instead of `new-session`**
Only useful if the user is already attached to tmux and wants to switch to an Aigon session. Not appropriate for headless creation.

### Best Practice for Aigon

Always use `-L aigon` (or a configurable socket name) for all tmux operations:
- Sessions are fully isolated from the user's tmux
- No `$TMUX` conflict regardless of user's environment
- `tmux -L aigon kill-server` cleanly destroys all Aigon sessions without affecting user's work
- User can still attach: `tmux -L aigon attach -t agent-1`
- Aigon can provide a wrapper: `aigon watch agent-1` -> `tmux -L aigon attach -t agent-1`

### Additional Consideration: tmux Control Mode
For maximum programmatic control, tmux's control mode (`-CC`) provides a machine-readable protocol:
- Line-based text protocol instead of terminal emulation
- `%output` notifications for all pane output
- `%begin`/`%end` blocks for command responses
- Characters < ASCII 32 are escaped as octal
- Could be used instead of polling `capture-pane`, giving real-time output notifications

This is what iTerm2 uses for its tmux integration. Aigon could potentially use control mode for the orchestrator connection, providing real-time output without polling. However, this adds significant complexity compared to simple `capture-pane` polling.

### Sources
- [Nested tmux sessions guide (koenwoortman.com)](https://koenwoortman.com/tmux-sessions-should-be-nested-with-care-unset-tmux-to-force/)
- [tmux in practice: nested sessions (freeCodeCamp)](https://www.freecodecamp.org/news/tmux-in-practice-local-and-nested-remote-tmux-sessions-4f7ba5db8795/)
- [tmux issue #3124: nested session error with attach-session](https://github.com/tmux/tmux/issues/3124)
- [tmux multiple servers with -L option](https://tmuxai.dev/tmux-multiple-servers/)
- [tmux Control Mode wiki](https://github.com/tmux/tmux/wiki/Control-Mode)
- [tmux discussion #4016: reading output in control mode](https://github.com/orgs/tmux/discussions/4016)
- [tmux man page](https://man7.org/linux/man-pages/man1/tmux.1.html)

---

## 8. Competitive Landscape: How Other Tools Manage Agent Sessions

### Three Dominant Patterns

The industry has converged on three approaches:

**Pattern 1: tmux + git worktrees (open-source standard)**
Used by: Claude Squad, Claude Code Agent Farm, AWS CLI Agent Orchestrator, NTM, Codex Orchestrator. Each agent gets a tmux session + git worktree. tmux provides detach/reattach, `capture-pane` for monitoring, `send-keys` for input. Zero infrastructure overhead.

**Pattern 2: Docker containers / VMs (cloud/enterprise)**
Used by: OpenHands, SWE-agent/SWE-ReX, Codex Cloud, Cursor Background Agents, Devin. Hard security boundaries, cloud-scalable, reproducible environments. Heavy for local workflows.

**Pattern 3: Subprocess headless mode (programmatic)**
Used by: Claude Code (`-p` + `stream-json`), Codex CLI (`codex exec --json`), Aider (`--message`). Lightest weight. Structured output for parsing. No interactive observation or human intervention during execution.

### Key Tools Examined

**OpenAI Codex CLI:** Local sandboxing via Landlock (Linux) / Seatbelt (macOS). `codex exec` for non-interactive mode with JSON Lines output. Cloud mode uses isolated containers per task with 12-hour caching. Known bug: parallel `codex exec` instances interfere via shared session restore state files.
- Sources: [Codex CLI Docs](https://developers.openai.com/codex/cli), [Parallel exec issue #11435](https://github.com/openai/codex/issues/11435)

**Cursor:** The most sophisticated IDE-integrated approach. Background agents run on AWS VMs. Async subagent trees (Cursor 2.5) — parent continues while subagents execute in parallel. Git worktree isolation with 1:1 agent-to-worktree mapping. "Best-of-N" mode runs same prompt across multiple models. But entirely tied to Cursor IDE — no external API.
- Sources: [Cursor Background Agents](https://docs.cursor.com/en/background-agent), [Cursor 2.5 Async Subagents](https://forum.cursor.com/t/cursor-2-5-async-subagents/152125)

**Aider:** Single-agent only. No built-in parallel mode. `--message` mode for scripting, `--yes` for auto-approval. Commonly used as a worker agent in external orchestrators like Claude Squad.
- Source: [Aider Scripting](https://aider.chat/docs/scripting.html)

**OpenHands (formerly OpenDevin):** Docker-based client-server. Each session gets its own container with a FastAPI ActionExecutionServer inside. Backend communicates over REST. Scales to thousands of agents via Kubernetes. No session persistence between conversations.
- Sources: [OpenHands Runtime Architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime), [Parallel Agent Refactors](https://openhands.dev/blog/automating-massive-refactors-with-parallel-agents)

**SWE-agent / SWE-ReX:** Cleanest execution runtime architecture. FastAPI server + pexpect inside Docker containers. Pluggable deployment (Docker, Fargate, Modal, Local). Multiple parallel shell sessions per container. Local/remote runtime interchangeability.
- Source: [SWE-ReX Architecture](https://swe-rex.com/latest/architecture/)

**Devin (Cognition Labs):** Cloud VMs with Brain (stateless intelligence) + Devbox (execution) split. Fork/rollback session capabilities. Machine snapshots. Fully proprietary and cloud-only.
- Source: [Devin 2.0 Technical Design](https://medium.com/@takafumi.endo/agent-native-development-a-deep-dive-into-devin-2-0s-technical-design-3451587d23c0)

**Warp Oz:** Launched Feb 2026 — the most complete cloud orchestration platform. CLI/SDK/REST API for launching agents. Cron, webhook, API triggers. Task lifecycle management. But commercial and cloud-only — no local session API for desktop terminal tabs.
- Sources: [Warp Oz Platform](https://www.warp.dev/oz), [Oz CLI Reference](https://docs.warp.dev/reference/cli/cli)

### AI-Specific Terminal Session Orchestrators (Most Relevant to Aigon)

| Tool | Architecture | Key Innovation | Source |
|------|-------------|----------------|--------|
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | tmux + git worktrees + TUI (bubbletea) | Agent-agnostic (Claude, Aider, Codex, Gemini); diff preview; pause/resume | smtg-ai |
| [Claude Code Agent Farm](https://github.com/Dicklesworthstone/claude_code_agent_farm) | Python + tmux + file-lock coordination | Battle-tested at 20-50 agents; auto-recovery; heartbeat monitoring | Dicklesworthstone |
| [AWS CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator) | tmux + MCP server (localhost:9889) | Three orchestration patterns (Handoff/Assign/Send Message); multi-agent communication | AWS Labs |
| [NTM](https://github.com/Dicklesworthstone/ntm) | Go CLI + tmux | Broadcast prompts to multiple agents; context monitoring; Agent Mail threads | Dicklesworthstone |
| [agent-tmux-monitor](https://github.com/damelLP/agent-tmux-monitor) | Rust (ratatui) daemon + TUI + hooks | Claude Code hooks via Unix socket; press Enter to jump to session | damelLP |
| [amux](https://github.com/mixpeek/amux) | Python + tmux + PWA | Web dashboard + mobile; ANSI parsing for state detection | Mixpeek |

### Implications for Aigon

The Claude Agent SDK approach (Section 6) puts Aigon ahead of nearly all existing orchestrators, which rely on the more fragile capture-pane + send-keys pattern. The closest competitor is Cursor's async subagent tree, but that's IDE-locked. The key takeaway: **tmux is the universal runtime, Agent SDK is the control plane, git worktrees are the isolation layer**.

---

## 9. Relationship to Existing Conductor Spec

### How tmux Changes the Architecture

The current `feature-conductor.md` uses `spawn()` with detached processes and polls status files. tmux **replaces the spawn approach** rather than layering on top:

| Conductor Spec | With tmux |
|---------------|-----------|
| `spawn(cmd, { detached: true })` | `tmux -L aigon new-session -d -s <name> "cmd"` |
| `proc.on('exit', ...)` for crash detection | `tmux -L aigon list-sessions` + check for session existence |
| Status file polling for completion | Status file polling (unchanged) + `capture-pane` for real-time state |
| No recovery if conductor crashes | tmux sessions survive conductor crash; resume on restart |
| No human intervention mechanism | `tmux attach` for immediate "jump in" |

### Agent Lifecycle Simplification

tmux simplifies crash detection and restart:

```javascript
// Current spec (fragile):
const proc = spawn(cmd, { cwd: worktreePath, detached: true });
proc.on('exit', (code) => {
  if (code !== 0) handleAgentFailure(agent, task, code);
});

// With tmux (robust):
execSync(`tmux -L aigon new-session -d -s ${sessionName} "${cmd}"`);
// Check if session is still alive:
const alive = !spawnSync('tmux', ['-L', 'aigon', 'has-session', '-t', sessionName]).status;
// Restart: just create a new session with the same name
```

### Status Dashboard as tmux

The conductor spec's "Status Dashboard" concept maps naturally to tmux:

**Option A: Conductor pane + agent panes in one tmux session**
```
┌─────────────────┬─────────────────┐
│   CONDUCTOR     │    agent-cc     │
│   (status TUI)  │  (Claude Code)  │
├─────────────────┼─────────────────┤
│    agent-cx     │    agent-gg     │
│   (Codex CLI)   │  (Gemini CLI)   │
└─────────────────┴─────────────────┘
```

**Option B (recommended): Separate sessions, `aigon watch` dashboard**
Each agent gets its own session. The conductor runs its own status display (log-update based). `aigon watch` shows the dashboard. `aigon attach <id> <agent>` jumps into a specific session.

### Interaction with Ralph Loops

Ralph already manages iterations and writes progress files. The conductor should **watch Ralph's status file**, not replace Ralph's iteration logic. tmux adds:
- Visibility into what Ralph is currently doing (not just the status file)
- Ability to "jump in" mid-iteration if something goes wrong
- Session persistence — Ralph survives conductor crashes

### Open Question #5 Resolution

> "If the conductor process is killed, can it resume?"

**With tmux: trivially yes.** tmux sessions persist independently of the conductor process. On restart, the conductor can:
1. `tmux -L aigon list-sessions` — discover what's still running
2. Read status files — determine where each agent left off
3. Resume monitoring without restarting agents

---

## 10. Should ALL Agent Sessions Use tmux?

### Solo Mode (`feature-implement`)

**Recommendation: No, keep the current terminal-based approach for solo mode.**

Solo mode is a single agent working interactively. The developer typically wants to watch it. Opening a Warp tab (current behavior) or running in the current terminal is the right UX. tmux adds complexity with no benefit when there's only one agent.

Exception: `feature-implement --ralph` (autonomous Ralph loops) could optionally run in tmux since the user isn't actively watching.

### Arena Mode (`feature-setup --arena`)

**Recommendation: Yes, replace Warp split panes with tmux sessions.**

Current problems with Warp split panes:
- Warp-specific — other terminals get "manual setup" instructions
- No programmatic monitoring (can't read what agents are doing)
- No way to selectively attach/detach from individual agents
- No persistence if terminal closes

With tmux:
- Terminal-agnostic — works everywhere
- `capture-pane` enables monitoring
- Selective attach/detach per agent
- Sessions persist across terminal closes
- `aigon watch --all` can show a dashboard of all agents

### Conductor Mode

**Recommendation: Mandatory tmux (or SDK) for all conductor-managed agents.**

The conductor requires programmatic control — it cannot work with visible terminal tabs. This is the primary use case for tmux.

### UX for "See What's Happening"

Three-level escalation:

```
aigon status [feature-id]     — Print current state, exit (non-interactive)
aigon watch [feature-id]      — Live-updating dashboard (log-update, Ctrl+C safe)
aigon attach <feature-id> <agent> — Jump into the tmux session (Ctrl+b d to detach)
```

`tmux attach` works from any terminal, including Warp. Warp's tmux support is limited (no blocks/AI completions inside tmux), but basic terminal functionality works. For users who want the full Warp experience when attaching, `aigon attach` could open a new Warp window:
```bash
open -a Warp -n --args -e "tmux -L aigon attach -t <session>"
```

### Nested tmux Concerns

The `-L aigon` separate server (Section 7) eliminates all nested tmux issues. Aigon's sessions are fully isolated from the user's tmux workflow.

### Hybrid Recommendation

| Mode | Session Layer | Rationale |
|------|--------------|-----------|
| Solo interactive | Current terminal (Warp/VS Code/Cursor) | User is watching; tmux adds friction |
| Solo Ralph | Optional tmux | Autonomous; user may want to detach |
| Arena | tmux (replaces Warp split panes) | Multiple agents need independent lifecycle |
| Conductor | tmux + Agent SDK | Mandatory programmatic control |

---

## 11. Conductor "Jump In" UX

### Notification System

**macOS desktop notifications via osascript (zero dependencies):**
```javascript
function notify(title, message, sound = 'default') {
  const script = `display notification "${message}" with title "${title}" sound name "${sound}"`;
  exec(`osascript -e '${script}'`);
}
```

For clickable notifications with "Attach" buttons, `node-notifier` (optional dependency) wraps `terminal-notifier` on macOS with action button and click callback support.

**Notification taxonomy:**

| Event | Priority | Sound | Rationale |
|-------|----------|-------|-----------|
| Agent completed task | Low | No | Informational |
| All agents completed | Medium | Default | Actionable: review results |
| Agent failed / crashed | High | Alert | Needs intervention |
| Agent needs input | High | Alert | Blocking |
| Agent stuck (no output N min) | Medium | Default | May need restart |

**Escalation ladder:**
```
0s   → Log event
5s   → Update dashboard status to "WAITING"
10s  → macOS notification (silent)
30s  → macOS notification WITH sound
2min → Terminal bell (\x07) + notification
```

Sources: [node-notifier GitHub](https://github.com/mikaelbr/node-notifier), [macOS notifications from Node.js](https://gist.github.com/LukaszWiktor/80d2423072a7b88ec14d7688ff9b7433)

### Agent State Detection

**For Claude Code (SDK-managed):** The `canUseTool` callback and SDK message stream provide clean programmatic state detection. No screen scraping needed.

**For agents without SDK callbacks (Gemini CLI, fallback):** Parse `capture-pane` output with two-tier detection:
```javascript
function detectState(paneOutput) {
  const stripped = stripAnsi(paneOutput);
  if (/Allow|Deny|Yes.*No|want to proceed/i.test(stripped)) return 'needs-input';
  if (/Error:|FATAL|panic|Traceback/i.test(stripped)) return 'error';
  if (/^>\s*$/m.test(stripped)) return 'idle';
  return 'running';
}
```

**For Codex CLI:** Parse the NDJSON event stream from `codex exec --json` for structured state detection — more reliable than screen scraping.

**Claude Code hooks** (tmux-agent-indicator pattern): Hook into `UserPromptSubmit` → running, `PermissionRequest` → needs-input, `Stop` → done. Most reliable for tmux-based agents.

Source: [tmux-agent-indicator](https://github.com/accessd/tmux-agent-indicator)

### Dashboard Implementation

**Recommended: `log-update` + raw ANSI (zero-friction, works everywhere)**

```
Aigon Conductor — Feature 42
──────────────────────────────────────────────
  ● cc   RUNNING   Implementing auth module     4m 32s
  ◎ cx   WAITING   Permission: run npm test     0m 12s
  ● gg   RUNNING   Writing unit tests           2m 15s
──────────────────────────────────────────────
[a]ttach  [r]efresh  [q]uit
```

Uses `log-update` (single npm dependency) for in-place terminal updates. Polls tmux sessions / SDK streams every 2-3 seconds. Press a key to attach to a selected agent.

Reserve heavier TUI frameworks (blessed, Ink) for a future `aigon dashboard` command if users demand richer visualization.

Sources: [log-update npm](https://www.npmjs.com/package/log-update), [blessed-contrib GitHub](https://github.com/yaronn/blessed-contrib), [Ink GitHub](https://github.com/vadimdemedes/ink)

### `aigon watch` and `aigon attach` Design

**`aigon watch [feature-id]`** — Live-updating status dashboard. Read-only. Ctrl+C exits safely (doesn't affect agents). Like `kubectl get pods --watch`.

**`aigon attach <feature-id> <agent>`** — Full interactive session.
```javascript
function attachToAgent(featureId, agentId) {
  const sessionName = `aigon-f${featureId}-${agentId}`;
  spawnSync('tmux', ['-L', 'aigon', 'attach-session', '-t', sessionName], {
    stdio: 'inherit'
  });
}
```
Detach with `Ctrl+b d` to return to headless mode. The agent continues running.

---

## Existing Ecosystem: Tools Already Doing This

Several projects already orchestrate Claude Code via tmux, validating the approach:

| Project | Approach | Notes |
|---------|----------|-------|
| [claude-yolo](https://github.com/claude-yolo/claude-yolo) | tmux + capture-pane polling (0.3s) + send-keys Enter | Auto-approves permissions; per-pane cooldowns; audit logging |
| [claude-tmux](https://github.com/nielsgroen/claude-tmux) | tmux popup with session management | Git worktree and PR support |
| [ntm (Named Tmux Manager)](https://github.com/Dicklesworthstone/ntm) | tmux panes with TUI command palette | Supports Claude, Codex, Gemini across tmux panes |
| [tmuxcc](https://github.com/nyanko3141592/tmuxcc) | TUI dashboard managing agents in tmux | Supports Claude Code, OpenCode, Codex CLI, Gemini CLI |
| [ccswarm](https://github.com/nwiizo/ccswarm) | Git worktree isolation + tmux | Multi-agent orchestration with specialized roles |
| [claude-mpm](https://github.com/bobmatnyc/claude-mpm) | Subprocess orchestration | Multi-agent with skills system and MCP integration |
| [orchestrating-tmux-claudes](https://smithery.ai/skills/dbmcco/orchestrating-tmux-claudes) | Claude Code skill | Skill for orchestrating multiple Claude sessions in tmux |

---

## Recommendation

### Primary Architecture: Headless Mode + tmux Hybrid

1. **Use each agent's native headless mode as the control plane:**
   - **Claude Code:** Agent SDK (TypeScript) with `canUseTool` callback, `stream-json` monitoring, `--resume` for crash recovery, `maxBudgetUsd` for cost control
   - **Codex CLI:** `codex exec --json --full-auto` for NDJSON event stream, `codex exec resume` for session continuity, or MCP server mode for Agents SDK orchestration
   - **Gemini CLI:** `gemini -p --output-format json --yolo` for auto-approved headless execution
   - The conductor parses each agent's structured output stream for monitoring

2. **Use tmux (with `-L aigon` separate server) as the human-intervention layer for ALL agents:**
   - Each agent's headless process runs inside a tmux session for observability
   - When the conductor detects an agent needs human input, it notifies the user
   - User attaches via `aigon attach <feature-id> <agent>` which wraps `tmux -L aigon attach`
   - Session resume (`--resume` / `codex exec resume`) allows picking up where the agent left off
   - tmux sessions survive conductor crashes — agents keep running

3. **Use `pipe-pane` for logging:**
   - All tmux sessions log to `~/.aigon/logs/<feature-id>/<agent>.log`
   - `aigon logs <feature-id> [agent]` tails the relevant log file

### All Major Agents Have Headless Modes

Contrary to an earlier assumption, all three major CLI agents support headless/non-interactive execution with structured output:

| Agent | Headless Flag | Structured Output | Auto-Approve | Session Resume | SDK |
|-------|--------------|-------------------|-------------|---------------|-----|
| **Claude Code** | `-p` / `--print` | `--output-format stream-json` (NDJSON) | `--allowedTools` per-tool | `--resume <session_id>` | Agent SDK (TS/Python) with `canUseTool` callback |
| **Gemini CLI** | `-p` | `--output-format json` | `--yolo` / `--approval-mode` | None | None (CLI only) |
| **Codex CLI** | `codex exec` | `--json` (NDJSON events) | `--full-auto` / `--ask-for-approval never` | `codex exec resume [SESSION_ID]` | Codex SDK (TS) + MCP server mode |

The conductor should use **each agent's native headless mode** rather than running them interactively in tmux. tmux is the human-intervention layer for all agents equally, not a fallback for agents without SDKs.

**Key SDK capability gap:** Only Claude Code's Agent SDK provides per-tool permission callbacks (`canUseTool`). Gemini CLI has no SDK at all. Codex CLI has an SDK and MCP server but uses policy-level approval (`untrusted` / `on-request` / `never`) rather than per-tool callbacks.

Sources:
- [Gemini CLI headless mode](https://google-gemini.github.io/gemini-cli/docs/cli/headless.html)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference/)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Codex + Agents SDK guide](https://developers.openai.com/codex/guides/agents-sdk/)

### Why Not Pure Headless (No tmux)?
The headless modes lack the "jump in" capability that makes tmux valuable:
- Users cannot attach to see what an agent is doing in real-time
- No way to manually intervene when programmatic approval isn't sufficient
- No visual debugging of agent behavior
- If the conductor process crashes, headless subprocesses die with it

### Why Not Pure tmux (No Headless)?
The capture-pane + send-keys approach (as proven by claude-yolo) works but is inherently fragile:
- Pattern matching on terminal output breaks when CLIs change their UI
- Polling introduces latency (minimum 0.3s response time to prompts)
- Collapsed transcripts require workarounds
- False positives from code output containing permission-like keywords

The hybrid approach — **headless mode for the control plane, tmux for the human-intervention plane** — gives the best of both worlds.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| conductor-tmux-sessions | Use tmux with dedicated `-L aigon` server for human-attachable agent sessions, replacing Warp split panes for arena/conductor modes | high | none |
| conductor-headless-orchestration | Use each agent's native headless mode (Claude SDK, `codex exec --json`, `gemini -p --output-format json`) as the control plane with structured output parsing | high | none |
| conductor-permission-handling | Per-agent permission strategy: Claude SDK `canUseTool` callback, Codex `--full-auto` / MCP approval-policy, Gemini `--yolo` / `--approval-mode` | high | conductor-headless-orchestration |
| conductor-watch-command | `aigon watch <feature-id> [agent]` — live-updating status dashboard with log-update; press key to attach | medium | conductor-tmux-sessions |
| conductor-attach-command | `aigon attach <feature-id> <agent>` — jump into a tmux session for interactive intervention, detach with Ctrl+b d | medium | conductor-tmux-sessions |
| conductor-notifications | macOS desktop notifications (osascript) for agent completion, failure, and needs-input events with configurable escalation | medium | conductor-tmux-sessions |
| conductor-session-resume | Crash recovery via Agent SDK `--resume session_id` for SDK agents and tmux persistence for tmux agents | medium | conductor-sdk-orchestration |
| conductor-log-pipeline | Use tmux `pipe-pane` to stream all agent output to log files; provide `aigon logs <feature-id> [agent]` command for tailing | medium | conductor-tmux-sessions |
| arena-tmux-migration | Replace `openInWarpSplitPanes()` with tmux sessions for arena mode, making arena terminal-agnostic | medium | conductor-tmux-sessions |
| conductor-status-dashboard | Simple `aigon status [feature-id]` prints one-shot status table for all agents (non-interactive) | low | conductor-tmux-sessions |
| conductor-agent-state-hooks | Use Claude Code hooks (UserPromptSubmit, PermissionRequest, Stop) for reliable agent state detection | low | conductor-tmux-sessions |
