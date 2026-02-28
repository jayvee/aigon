# Feature: Warn when agent-required commands are run from a bare shell

## Purpose

Several aigon commands (`feature-implement`, `feature-eval`, `research-conduct`, `research-synthesize`, `feature-review`) are designed to be run **inside an AI agent session** as slash commands (e.g., `/aigon:feature-implement 07`). When run from a bare terminal, they print instructions that no agent will read — the user gets verbose output but nothing actually happens.

A developer who discovers Aigon and tries `aigon feature-implement 07` from their terminal will see a wall of text and conclude "nothing happened". The CLI should detect this and immediately explain what to do instead.

## User Story

> As a developer who just installed Aigon, when I try to run `aigon feature-implement 07` from my terminal not knowing it's an agent command, I want a clear, short warning that explains I'm in the wrong context, tells me what the correct context is, and suggests the right alternative — so I can get started without confusion.

---

## How to detect "inside an agent"

Check environment variables set by known agent CLIs:

| Agent | Env var |
|-------|---------|
| Claude Code | `CLAUDE_CODE` or `CLAUDECODE` |
| Cursor | `CURSOR_TRACE_ID` or similar |
| Gemini CLI | `GEMINI_CLI` or similar |
| Codex | `OPENAI_CODEX_CLI` or similar |

If **none** of these are present, and the command is in the agent-required list, show the warning.

Also consider: if running with `--ralph`, no warning is needed (Ralph drives the agent itself from the shell).

---

## Proposed behaviour

When an agent-required command is run from a bare shell (no known agent env var detected, no `--ralph` flag):

```
$ aigon feature-implement 07

⚠️  This command is meant to run inside an AI agent session.

Running 'aigon feature-implement' from the terminal will print instructions
that an agent should read — but without an agent, nothing will be implemented.

To implement this feature:
  1. Open your agent (Claude Code, Cursor, Gemini, Codex)
  2. Run: /aigon:feature-implement 07

Or, let Ralph handle it autonomously:
  aigon feature-implement 07 --ralph

```

The warning is printed to stdout (not stderr) and the regular command output follows, so the behaviour is **non-breaking** — the instructions still appear for anyone who knows what they're doing.

---

## Agent-required commands

The warning should apply to commands that produce instructions for agents to act on:

- `feature-implement`
- `feature-eval`
- `feature-review`
- `research-conduct`
- `research-synthesize`

Commands that do NOT need the warning (they are pure shell utilities):
- `feature-create`, `feature-prioritise`, `feature-setup`, `feature-done`, `feature-cleanup`, `feature-validate`
- `research-create`, `research-prioritise`, `research-setup`, `research-done`
- `board`, `init`, `install-agent`, `update`, `dev-server`, `hooks`
- Any command with `--ralph` flag

---

## Implementation notes

Add a `AGENT_REQUIRED_COMMANDS` set and a `detectAgentContext()` function. Call it at the top of the relevant command handlers:

```js
const AGENT_REQUIRED_COMMANDS = new Set([
  'feature-implement',
  'feature-eval',
  'feature-review',
  'research-conduct',
  'research-synthesize',
]);

function detectAgentContext() {
  return !!(
    process.env.CLAUDECODE ||
    process.env.CLAUDE_CODE ||
    process.env.CURSOR_TRACE_ID ||
    process.env.GEMINI_CLI ||
    process.env.OPENAI_CODEX_CLI
  );
}
```

Print warning before main output if `!detectAgentContext() && !args.includes('--ralph')` and command is in `AGENT_REQUIRED_COMMANDS`.

The warning should use the same visual formatting as other aigon console output (no fancy box-drawing required, but should be visually distinct from the regular output — e.g., a blank line + `⚠️` prefix + blank line).

---

## Files to change

| File | Change |
|---|---|
| `aigon-cli.js` | Add `AGENT_REQUIRED_COMMANDS`, `detectAgentContext()`, and warning injection at the start of each agent-required command handler |

After editing the template, run `aigon update` to sync to working copies.

---

## Acceptance Criteria

- [ ] Running `aigon feature-implement <ID>` from a bare shell (no agent env var) prints a warning before the regular output explaining the command is meant for agent sessions
- [ ] The warning names the correct slash command to use and the `--ralph` alternative
- [ ] Running `aigon feature-implement <ID> --ralph` shows NO warning
- [ ] Running `/aigon:feature-implement <ID>` inside Claude Code shows NO warning (CLAUDECODE env var is present)
- [ ] The warning applies to all 5 agent-required commands: `feature-implement`, `feature-eval`, `feature-review`, `research-conduct`, `research-synthesize`
- [ ] Commands that are not agent-required (feature-setup, feature-done, board, etc.) show NO warning
- [ ] The regular command output still appears after the warning — behaviour is non-breaking
- [ ] Warning text is clear, short (max 8 lines), and includes both the slash-command path and the `--ralph` alternative

---

## Out of scope

- Blocking execution or exiting with non-zero status (the command should still run)
- Detecting all possible agent environments exhaustively (add more env vars as discovered)
- Showing the warning inside agent sessions even if env var detection is incomplete (false positives)
