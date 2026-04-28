# Adding Agents to Aigon

## When to add a new agent

Not every CLI earns a slot. Before starting the onboarding process, a candidate CLI must clear at least one of these bars:

1. **Unlocks a model with no other CLI route** — the model is genuinely inaccessible via the existing agents. Example: `km` (Kimi K2) earns its slot because Kimi K2 has no other natural CLI path and has a strong performance/cost ratio for code work.

2. **Native CLI for a major foundation model provider** — the agent is the first-party CLI for a provider whose models are already in high demand. Example: `cc` (Claude Code), `gg` (Gemini CLI), `cx` (Codex CLI). A router CLI (Aider, Cline, etc.) wrapping the same model does *not* clear this bar — the native CLI will always be better optimised.

3. **Genuinely superior workflow for Aigon's use case** — the CLI offers a fundamentally different and better workflow than existing agents for feature implementation specifically.

**Hard disqualifiers** — a CLI fails immediately if:
- It exits after completing a task (one-shot / batch mode). Aigon requires the agent to stay at its own interactive prompt so the tmux session remains observable and interactable.
- It cannot reliably execute shell commands (e.g. `aigon agent-status implementation-complete`) from inside the agent session.
- Context delivery requires manual configuration per repo with no auto-discovery path.

**Evaluated candidates (as of 2026-04-28):**

| CLI | Verdict | Reason |
|---|---|---|
| GitHub Copilot | ❌ Skip | Wraps foundation models already covered by native CLIs (cc, gg, cx); no unique model access |
| Aider | ❌ Disqualified | Exits after each task; shell execution unreliable; no auto-context discovery |
| Cline CLI 2.0 | ⏳ Monitor | Too new (Feb 2026); context delivery conventions unknown; revisit Q3 2026 |
| Amazon Q | ❌ Low priority | ~50–66% SWE-bench (below current roster); Nova models reachable via op/Bedrock |
| Goose | 🤔 Possible | OSS, model-agnostic; overlaps heavily with op (OpenCode); only adds value if op proves insufficient |

---

## Decision Tree

Answer these 5 questions in order to determine the correct configuration for any new agent.

---

**Q1: Does the CLI accept an initial prompt as a command-line argument?**

- **NO** → type: **TUI-inject** — set `cli.injectPromptViaTmux: true`, `capabilities.resolvesSlashCommands: false`. The agent's TUI is launched bare; aigon pastes the prompt into the live pane after auth. Examples: `op` (opencode), `km` (kimi)
- **YES** → go to Q2

**Q2: Does the CLI understand `/slash-command` syntax natively?**

- **YES** → type: **Slash-command** — set `capabilities.resolvesSlashCommands: true`. The prompt is passed as `/aigon-feature-do {featureId}` directly on the command line. Examples: `cc` (claude), `gg` (gemini), `cu` (agent/cursor)
- **NO** → type: **File-prompt** — set `capabilities.resolvesSlashCommands: false`. The full prompt body is written to a temp file and passed as `$(< /path/to/file)` shell expansion. Example: `cx` (codex)

**Q3: Does `--model <id>` work as a CLI flag?**

- **YES** → `capabilities.supportsModelFlag: true`
- **NO** → `capabilities.supportsModelFlag: false` — aigon strips `--model` from the launch command to avoid errors

**Q4: Does the agent stay at its own interactive prompt after completing a task?**

- **YES** (all current agents) → no `exec bash -l`; the tmux session stays at the agent's own prompt and remains interactive
- **NO** (batch/headless) → `shellTrap` becomes the primary signal path; document this clearly in the `signals` section and note it in `docs/agents/<id>.md`

**Q5: Can aigon read the agent's transcript or session file?**

- **YES** → `capabilities.transcriptTelemetry: true`; also set `runtime.sessionStrategy` to the appropriate value (e.g. `claude-jsonl`, `gemini-chats`)
- **NO** → `capabilities.transcriptTelemetry: false`

---

## Launch Type Reference

| Type | Agents | Prompt delivery | Session after work |
|---|---|---|---|
| Slash-command | `cc` (claude), `gg` (gemini), `cu` (agent/cursor) | `/aigon-feature-do XX` as CLI arg | Stays at agent's interactive prompt |
| File-prompt | `cx` (codex) | `$(< /tmp/aigon-prompt-XX.md)` shell expansion | Stays at agent's interactive prompt |
| TUI-inject | `op` (opencode), `km` (kimi) | Pasted via `tmux paste-buffer` after TUI is ready | Stays at agent's interactive prompt |

---

## Key Files

Read these before adding a new agent:

- **`templates/agents/<id>.json`** — source of truth for all agent config; use `templates/feature-template-agent-onboard.md` as a checklist when creating a new one
- **`lib/agent-registry.js`** — queries capabilities at runtime (`supportsModelFlag`, `isSlashCommandInvocable`, `getProcessDetectionMap`, etc.)
- **`lib/worktree.js`** `buildRawAgentCommand` / `buildAgentCommand` — how the config drives the tmux launch; the `injectPromptViaTmux` path and the slash-command path diverge here
- **`lib/config.js`** `getAgentLaunchFlagTokens` — flag injection logic per launch type
- **`tests/integration/worktree-state-reconcile.test.js`** — add one assertion block per new agent covering its launch command shape; see existing blocks for `cc`, `cu`, `op`, `km`, `gg` as examples
