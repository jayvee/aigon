---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T07:39:01.638Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-context-misidentifies-codex-as-cursor

## Summary

`aigon agent-context --id-only` can report `cu` (Cursor) from a Codex local session because `detectActiveAgentSession()` accepts broad substring matches against every parent process command line. Cursor's configured CLI command is the short token `agent`, so a shell wrapper command containing text like `agent-context`, `AIGON_AGENT_ID`, or `detectActiveAgentSession` matches Cursor before the resolver reaches the real `codex` parent process.

This breaks any workflow that relies on `agent-context` to backfill `AIGON_AGENT_ID`, including spec-review commit attribution. A Codex reviewer can be recorded as Cursor even though the process ancestry contains `codex resume`.

## User Stories

- [x] As a Codex local agent running Aigon commands through a shell wrapper, `aigon agent-context --id-only` resolves to `cx`, not `cu`.
- [x] As an Aigon reviewer, spec-review commits and `spec_review.submitted` events are attributed to the actual agent process, not to an incidental substring in the shell command line.
- [x] As an Aigon maintainer, adding short or generic agent CLI commands does not create false positives in process ancestry detection.

## Acceptance Criteria

- [x] In a Codex session where the parent process chain contains an exact `codex` executable, `aigon agent-context --id-only` prints `cx` even when an intermediate shell command line contains `agent-context`.
- [x] `detectActiveAgentSession()` does not classify a parent shell as Cursor solely because its full command line contains the substring `agent` inside another token such as `agent-context`, `AIGON_AGENT_ID`, or `detectActiveAgentSession`.
- [x] Exact executable matches still work for all configured agent commands from `templates/agents/*.json` (`claude`, `codex`, `gemini`, `agent`, `kimi`, `opencode`).
- [x] Fuzzy command-line matching tokenizes argv/path basenames and rejects partial-token matches for short or generic commands such as `agent`; longer or distinctive commands may still match as standalone tokens.
- [x] When both an incidental fuzzy match and a deeper exact executable match are present in the ancestry, the exact executable match wins.
- [x] Regression test covers the observed failure shape: a synthetic parent chain with `zsh -c "aigon agent-context --id-only"` above `codex resume` resolves to `cx`.
- [x] Regression test covers the direct Cursor case: a parent process whose executable basename is exactly `agent` still resolves to `cu`.

## Validation

```bash
node -c lib/config.js
node -c lib/agent-registry.js
node tests/integration/agent-context-detection.test.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration because this feature touches CLI/session detection only.
- May add a small test-only helper or dependency-injection seam around process ancestry reads in `lib/config.js` if needed to test `detectActiveAgentSession()` without relying on the host process tree.

## Technical Approach

### Root cause

Current code:

- `lib/config.js:98` walks parent processes in `detectActiveAgentSession()`.
- `lib/config.js:117-120` checks `argsRaw.includes(hint.key)` for every configured agent command.
- `lib/agent-registry.js:204-209` builds those command keys directly from `templates/agents/<id>.json`.
- `templates/agents/cu.json` sets Cursor's command to `agent`.
- `templates/agents/cx.json` sets Codex's command to `codex`.

The exact executable path is already enough to resolve Codex when the immediate parent is the Codex binary. The bug appears when a shell wrapper remains in the ancestry. The shell's args include `agent-context`, so the broad `includes("agent")` check returns Cursor before the walker reaches the deeper `codex` process.

### Recommended fix

Prefer exact process executable matching over fuzzy argument matching across the full ancestry:

1. Walk the parent process chain and collect lightweight entries `{ pid, commBase, argsRaw }`.
2. First pass: return the nearest exact `commBase` match from `agentRegistry.getProcessDetectionMap()`.
3. Second pass, only if no exact match exists: evaluate fuzzy matches against tokenized argv/path basenames, not raw substrings.
4. Treat short/common command keys such as `agent` as exact-token-only; never match them inside larger tokens.

This keeps Cursor detection working when the executable is actually `agent`, while preventing shell command text from shadowing a deeper Codex process. The existing env-var fallbacks (`CURSOR_TRACE_ID`, `OPENAI_CODEX_CLI`, `GEMINI_CLI`) remain unchanged and operate only when the ancestry walk finds no match.

### Test strategy

Add a focused integration/unit test that stubs the process ancestry reads instead of relying on real `ps` output. If `detectActiveAgentSession()` cannot be tested cleanly today because `execSync` is captured at module load, introduce a small internal helper that accepts `{ getProcessInfo, startPid }` and keep the exported behavior unchanged.

The test fixtures should include:

- Shell wrapper false positive: `zsh` args contain `aigon agent-context --id-only`; parent is `codex resume`; result is `cx`.
- Cursor exact executable: `commBase === 'agent'`; result is `cu`.
- Partial-token guard: `zsh` args contain `AIGON_AGENT_ID` with no real agent process; result is not `cu`.
- Interpreter-wrapped agent: `commBase === 'node'` with args containing `claude`; result is `cc` (confirms the tokenized second pass still resolves interpreter-launched agents).

## Dependencies

- No feature dependencies.

## Out of Scope

- Changing agent IDs, agent template command names, or installed Cursor/Codex launch commands.
- Reworking session sidecars, telemetry attribution, or spec-review event schemas.
- Repairing already-recorded misattributed review events; this feature prevents new false attribution.

## Open Questions

None.

## Related

- Observed during feature 494 spec review: `AIGON_AGENT_ID` was empty, `aigon agent-context --id-only` returned `cu`, and the `spec_review.submitted` event recorded `reviewerId: "cu"` even though the session was Codex.
- Code: `lib/config.js`, `lib/agent-registry.js`, `templates/agents/cu.json`, `templates/agents/cx.json`, `lib/commands/misc.js`.
