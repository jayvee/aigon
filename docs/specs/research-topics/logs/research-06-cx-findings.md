# Research Findings: tmux conductor

**Agent:** Codex (cx)
**Research ID:** 06
**Date:** 2026-02-28

---

## Key Findings

1. `tmux capture-pane` is useful for snapshots, but it is not a complete event stream.
- `capture-pane` defaults to visible content; `-S/-E` are required to include history ranges, and negative indices reference history.
- `-a` switches to alternate screen and makes history inaccessible; `-M` captures mode screen instead.
- Escape/output fidelity is nuanced (`-e`, `-C`, `-J`, `-N`, `-P`), so parsing captured text as a strict protocol is fragile.

2. For reliable monitoring, tmux control mode + hooks beat periodic pane scraping.
- Control mode emits structured blocks (`%begin/%end/%error`) plus notifications (`%output`, `%extended-output`, `%exit`, etc.).
- tmux has lifecycle hooks (`pane-exited`, `pane-died`) that map directly to process state transitions.
- Conclusion: use control mode notifications for streaming observability, and hooks/status signals for lifecycle transitions.

3. Output scraping alone is not a sufficient completion/failure contract.
- Agent text can be ambiguous and provider-specific; parsing natural-language completion messages is brittle.
- Existing conductor status files remain the best source of truth for `in-progress -> submitted -> done`.
- tmux should enhance observability and intervention, not replace explicit status signaling.

4. Overhead for 4-6 sessions is likely acceptable, but output policy matters (inference).
- tmux keeps per-pane history (default 2000 lines). Memory scales with pane count, history depth, and output volume.
- Control-mode clients can be terminated as `too far behind`; `pause-after`/`no-output` exist specifically to control backpressure.
- Practical implication: 4-6 concurrent sessions are feasible if history limits are bounded and non-essential output is throttled.

5. `tmux send-keys` can drive interactive CLIs, but it is low-level and brittle for approvals.
- `send-keys` injects key sequences/literals; it does not provide semantic prompt handling.
- It can answer simple prompts, but robust automation should prefer explicit non-interactive/JSON modes where available.
- Keep human takeover as first-class (`attach`/`watch`) for unexpected prompts.

6. tmux is the strongest local backend today, with viable but weaker alternatives.
- **screen**: mature detach/reattach and detached start modes; less modern programmability.
- **zellij**: strong UX and session serialization/resurrection; less ubiquitous than tmux.
- **abduco+dvtm**: very lightweight detach/reattach + tiling, but smaller ecosystem.
- Recommendation: use tmux as default backend behind a backend abstraction interface.

7. Warp does not currently replace local tmux-style session control for this use case.
- Warp local-agent docs focus on desktop interactions and third-party CLI integration inside Warp.
- Warp Oz cloud platform exposes orchestration API/SDK for cloud tasks, which is valuable but is a different execution model.
- Conclusion: keep local conductor session control independent of Warp UI APIs.

8. tmux should layer onto the existing Conductor spec, not replace it.
- Keep `spawn()` and status-file contract from `feature-conductor.md`.
- Change launch target to run each agent command inside a named detached tmux session/window.
- Add event bridge: tmux hook/control events -> conductor event bus -> dashboard/alerts.

9. Ralph interaction: tmux is observability + intervention, not loop logic.
- Ralph already persists iteration state; Conductor should continue reading Ralph/status artifacts for control logic.
- tmux adds resumability, attach-on-demand, and faster root-cause debugging when an iteration stalls.

10. All agent sessions should not default to tmux.
- Recommended hybrid:
  - **Conductor / autonomous arena**: tmux default (headless-first).
  - **Manual solo `feature-implement`**: current interactive terminal default.
  - **Optional flag** for solo to opt into tmux (`--headless` / `--tmux`).
- Detect nested multiplexer context (`TMUX`) and avoid surprising nested attach behavior.

11. Competitive landscape: most tools use managed/cloud task runtimes, not local multiplexers.
- **Codex**: non-interactive `exec` for one-shot runs; multi-agent supports in-process by default and optional isolated branches/sandboxes.
- **Cursor Background Agent**: remote VM execution with checkpoints, PR handoff, and Slack integration.
- **Aider**: architect mode is two-model workflow (architect+editor), not multi-session orchestration.
- **OpenHands / SWE-agent / Devin**: task/session-oriented orchestration, generally outside a local tmux model.

12. Claude Code “headless vs tmux interactive” trade-off is clear.
- Claude CLI documents `--print` with `--output-format` (`text|json|stream-json`) and schema-constrained JSON output.
- No documented `--output-file` flag in current CLI reference; file persistence should be done by shell redirection.
- For conductor: prefer headless structured output where possible; reserve tmux interactive paths for human intervention and rich terminal tools.

## Sources

- tmux manual (primary):
  - https://raw.githubusercontent.com/tmux/tmux/master/tmux.1
- GNU screen manual:
  - https://www.gnu.org/software/screen/manual/screen.html
- Zellij docs:
  - https://zellij.dev/documentation/cli-actions.html
  - https://zellij.dev/documentation/options
- abduco / dvtm:
  - https://github.com/martanne/abduco
  - https://github.com/martanne/dvtm
- Warp docs (local + cloud orchestration):
  - https://docs.warp.dev/agent-platform/local-agents/overview
  - https://docs.warp.dev/agent-platform/local-agents/third-party-cli-agents
  - https://docs.warp.dev/agent-platform/cloud-agents/platform
- Codex docs:
  - https://developers.openai.com/codex/non-interactive
  - https://developers.openai.com/codex/multi-agent
- Cursor background agents:
  - https://docs.cursor.com/background-agent
- Aider chat modes / architect mode:
  - https://aider.chat/docs/usage/modes.html
- Anthropic Claude Code CLI reference:
  - https://docs.anthropic.com/en/docs/claude-code/cli-reference
- OpenHands:
  - https://github.com/All-Hands-AI/OpenHands
  - https://docs.openhands.dev/
- SWE-agent:
  - https://github.com/SWE-agent/SWE-agent
  - https://swe-agent.com/latest/
- Devin sessions:
  - https://docs.devin.ai/essential-guides/sessions

## Recommendation

Adopt a **hybrid architecture**: tmux-backed execution for conductor/autonomous runs, status-file contract as source-of-truth, and optional human attach.

Recommended design:
1. Add a session backend interface with `tmux` as default for `conduct` and headless arena.
2. Keep status files as authoritative state; never infer completion solely from pane text.
3. Use tmux control mode notifications + hooks for real-time telemetry, crash detection, and backpressure handling.
4. Add `aigon watch <feature-id> [agent]` for jump-in UX (`attach`, `tail`, `status`).
5. Keep solo interactive flows unchanged by default; expose explicit opt-in headless mode.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| conductor-session-backend | Introduce a pluggable session backend interface (`tmux` first, future backends possible). | high | none |
| tmux-session-launcher | Launch each conductor agent in named detached tmux sessions/windows with deterministic naming. | high | conductor-session-backend |
| status-contract-source-of-truth | Preserve status-file lifecycle as authoritative completion state independent of terminal output. | high | none |
| tmux-control-mode-monitor | Add control-mode event ingestion (`%output/%exit/%error`) with throttling and lag handling. | high | tmux-session-launcher |
| tmux-lifecycle-hooks-bridge | Wire `pane-exited`/`pane-died` and related hooks into conductor crash/restart logic. | high | tmux-session-launcher |
| aigon-watch-command | Add `aigon watch <feature-id> [agent]` for attach/tail/status jump-in workflows. | high | tmux-session-launcher |
| conductor-notifications-macos | Emit completion/failure/needs-attention notifications (e.g., via `osascript` or notifier tooling). | medium | tmux-control-mode-monitor |
| solo-headless-opt-in | Add `feature-implement --headless`/`--tmux` without changing default interactive UX. | medium | conductor-session-backend |
| nested-tmux-safety | Detect `TMUX` context and apply safe attach/namespace behavior to avoid nested confusion. | medium | tmux-session-launcher |
| warp-cloud-backend-spike | Explore optional future backend targeting Warp Oz API for cloud execution mode. | low | conductor-session-backend |
