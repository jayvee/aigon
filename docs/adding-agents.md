# Adding Agents to Aigon

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
