# Implementation Log: Feature 24 - shell-agent-warning

## Plan

Single-file change to `aigon-cli.js`. Build on the existing `detectActiveAgentSession()` function (already present for shell-launch detection). Add a `printAgentContextWarning()` helper and inject it into the 5 agent-required command handlers.

## Progress

- Added `printAgentContextWarning(commandName, id)` after `detectActiveAgentSession()` (~line 95)
- Injected call into `feature-implement` handler (after ralph check, before main output)
- Injected call into `feature-eval` handler
- Injected call into `research-conduct` handler
- Added new `feature-review` handler (previously fell through to "Unknown command")
- Added new `research-synthesize` handler (previously fell through to "Unknown command")
- Ran `aigon update` to sync to working copies

## Decisions

**Reused `detectActiveAgentSession()`** — this function already existed for the shell-launch feature. No need to add a new `AGENT_REQUIRED_COMMANDS` set as the spec suggested; instead the warning function itself is only called from the 5 specific handlers, which is cleaner.

**Warning before existing output, not replacing it** — all 3 commands with existing handlers (`feature-implement`, `feature-eval`, `research-conduct`) still produce their full output after the warning. This is non-breaking for users who know what they're doing.

**feature-review and research-synthesize get warning-only handlers** — these two had no CLI handlers at all, so they previously showed "Unknown command". Adding handlers that just call `printAgentContextWarning()` is a strict improvement: the user now gets actionable guidance instead of a confusing error.

**`--ralph` suppression via existing code path** — `feature-implement` checks `--ralph` before calling `printAgentContextWarning()`, so Ralph mode never shows the warning. No need to pass `args` into the warning function.

**Warning includes `--ralph` alternative only for `feature-implement`** — the other 4 commands don't have a Ralph mode, so their warning omits that line. This keeps the message accurate and concise.
