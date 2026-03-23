# Research: tmux-conductor

## Context

Aigon's current arena/solo modes launch agent sessions in visible Warp terminal tabs that the user watches side-by-side. This is useful for demos and debugging, but doesn't scale — watching 3-4 terminals isn't adding value when the agents are autonomous. The planned Conductor feature (`feature-conductor.md`) assumes it will spawn and monitor agent processes, but doesn't specify the session management layer.

The hypothesis: instead of visible terminal tabs, agent sessions should run in detached tmux (or similar) sessions. A conductor can monitor them programmatically, and a human can attach to any session on demand to observe or intervene. This would make the conductor truly headless by default, with optional "jump in" capability.

This research should determine the right session management approach for the conductor, evaluate alternatives to tmux, and understand what comparable tools in the ecosystem do.

## Questions to Answer

### Session management mechanics
- [ ] How does tmux `capture-pane` perform for monitoring agent output? What are the limits (scrollback, binary output, long lines)?
- [ ] Can the conductor reliably detect agent completion/failure by scraping tmux pane content, or do we still need the status-file signal approach from `feature-conductor.md`?
- [ ] What's the overhead of running 4-6 concurrent tmux sessions with active Claude Code / Gemini / Codex agents?
- [ ] How does `tmux send-keys` interact with Claude Code's interactive mode? Can the conductor send input (e.g. approve a permission prompt, answer a question)?
- [ ] Is tmux the right tool, or should we consider alternatives: screen, zellij, abduco+dvtm, or just background processes with PTY capture?
- [ ] Does Warp terminal have any API or programmatic session control that could replace tmux while keeping Warp's UX benefits?

### Relationship to existing conductor spec
- [ ] The existing `feature-conductor.md` uses `spawn()` with detached processes and polls status files. How does tmux change this architecture? Does it replace the spawn approach entirely, or layer on top?
- [ ] Does tmux simplify or complicate the conductor's agent lifecycle management (crash detection, restart, cleanup)?
- [ ] The conductor spec has a "Status Dashboard" concept — should this be a tmux pane itself (e.g. a conductor window with status, plus one pane per agent)?
- [ ] How does this interact with Ralph loops? Ralph already manages iterations — does the conductor just watch Ralph's status file, or does tmux give us something better?

### Should ALL agent sessions use tmux?
- [ ] Should `feature-implement` (solo mode) also run in tmux by default, or only when the conductor orchestrates?
- [ ] Should `feature-setup --arena` create tmux sessions instead of Warp tabs?
- [ ] What's the UX for a developer who wants to "see what's happening"? Is `tmux attach` good enough, or do we need a wrapper (e.g. `aigon watch 36` that attaches to the right session)?
- [ ] Is there a hybrid: tmux for the conductor's headless runs, Warp tabs for interactive/manual runs?
- [ ] What happens when a user is already using tmux for their own workflow? Nested tmux issues?

### Competitive landscape
- [ ] What session management does Codex CLI use when running autonomously?
- [ ] How does Cursor's background agent / multi-file agent handle session management?
- [ ] What does Aider's multi-agent or parallel mode use (if anything)?
- [ ] How do tools like OpenHands, SWE-agent, or Devon manage multiple concurrent agent sessions?
- [ ] Are there any AI-specific orchestration frameworks (not just LangGraph/CrewAI task graphs, but actual terminal session orchestrators)?
- [ ] How does Claude Code's `--output-file` / `--print` mode compare to running interactively in tmux? Trade-offs for the conductor use case?

### Conductor "jump in" UX
- [ ] What's the ideal workflow for a conductor to alert a human that an agent needs attention?
- [ ] How should `aigon watch <feature-id> [agent]` work? Attach to tmux? Open in Warp? Show a log tail?
- [ ] Can we get desktop notifications (macOS) when an agent finishes, fails, or needs input?
- [ ] Should the conductor have a TUI dashboard (blessed/ink) or is plain terminal output sufficient?

## Scope

### In Scope
- tmux (and alternatives) as the session layer for autonomous agent runs
- How this integrates with the existing conductor feature spec
- Competitive analysis of how other AI coding tools manage parallel agents
- UX design for "headless by default, attachable on demand"

### Out of Scope
- Implementing the conductor itself (that's the feature spec)
- Remote/distributed agent management (SSH + tmux is a future topic)
- Web-based dashboards
- Task decomposition and assignment logic (covered in conductor spec)

## Inspiration
- Current `research-open` command already opens multiple Warp tabs — this research asks "what if they didn't need to be visible?"
- The `feature-conductor.md` spec's open question #5: "If the conductor process is killed, can it resume?" — tmux makes this trivially yes
- User observation: side-by-side Warp terminals aren't adding value when agents are autonomous
