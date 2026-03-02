# Implementation Log: Feature 25 - context-aware-next
Agent: cc

## Plan

The feature adds a `/aigon:next` command (alias `/an`) that inspects the current git branch, working tree status, and Kanban board to suggest the most likely next workflow action. The approach was entirely prompt-driven: no CLI logic required — the command template guides the agent through a decision tree using existing CLI tools (`git branch`, `git status`, `aigon board`).

Key implementation areas:
1. New command template (`templates/generic/commands/next.md`)
2. Register the command in all 4 agent configs (cc, gg, cx, cu)
3. Add `'an': 'next'` alias to `COMMAND_ALIASES` in `aigon-cli.js`
4. Add `'next'` to `COMMAND_ARG_HINTS`, CLI help text, and a minimal CLI handler
5. Update `templates/generic/commands/help.md` to document the new command and alias

## Progress

### What was implemented

- **`templates/generic/commands/next.md`** — The full agent prompt template covering 5 decision tree paths:
  - Path A: Feature branch + uncommitted changes → suggest `feature-submit`
  - Path B: Feature branch + no changes → suggest `feature-submit` or `feature-implement`
  - Path C: Research branch → suggest `research-conduct` or `research-done`
  - Path D: Main branch → suggest `feature-eval` (arena), `feature-done` (solo), or show board (nothing active)
  - Path E: Ambiguous context → fall back to showing board

- **`templates/agents/{cc,gg,cx,cu}.json`** — Added `"next"` to the `commands` array in all 4 agent configs. The `install-agent` command will now write `next.md` (and the `an.md` alias) into each agent's command directory.

- **`aigon-cli.js`**:
  - `COMMAND_ALIASES`: added `'an': 'next'`
  - `COMMAND_ARG_HINTS`: added `'next': ''`
  - `commands['next']`: minimal handler that tells users this is agent-only and how to invoke it
  - Help text: added `Context-Aware:` section listing the `next` command

- **`templates/generic/commands/help.md`** — Added `Context-Aware` section with `/aigon:next` and `/an` to the shortcuts table

### What was tested

- `node --check aigon-cli.js` passes ✅
- `node aigon-cli.js next` prints the expected agent-only message ✅
- `node aigon-cli.js help` shows the new `Context-Aware:` section ✅

## Decisions

**Prompt-driven, no CLI execution logic** — The spec was explicit that this should be purely agent-driven (agent reads context and decides). No new `aigon next` subcommand logic was added beyond a simple informational handler. This keeps the implementation minimal and avoids coupling context detection logic into the CLI.

**Alias `'an'` not `'n'`** — All existing aliases follow the `a` + abbreviated prefix pattern (e.g., `afc`, `afn`, `ah`). Added `'an'` to stay consistent rather than using a bare `'n'` which would be unusually short and out of pattern. The slash command is `/an`.

**Graceful fallback to board** — When context is ambiguous (unrecognised branch pattern), the template instructs the agent to run `aigon board` and display the output rather than guessing. This prevents wrong suggestions that could confuse users.

**`aigon feature-implement --info` not available** — The spec mentioned using this flag to get current stage, but the flag doesn't exist in the CLI. The template works around this cleanly by using `aigon board --list --active` and branch name parsing, which provides equivalent information.
