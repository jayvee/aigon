---
complexity: high
---

# Feature: idle-agent-detection

## Summary

Detect when an agent session is paused waiting for human input and surface a blinking amber indicator on the dashboard kanban card. Detection uses `tmux capture-pane` pattern matching driven by per-agent `idleDetection` config in `templates/agents/<id>.json` — the same file that already defines failure detectors and signals for each agent. The supervisor sweep reads the pattern for the relevant agent, captures the last few lines of the pane, and writes an `idleAtPrompt` flag alongside the existing `awaitingInput` sidecar. The dashboard reads `idleAtPrompt` from the status payload and applies the existing `awaiting-input` CSS card treatment (amber ring) that is already wired but currently only fires from the explicit `aigon agent-status awaiting-input` call.

## User Stories

- [ ] As an operator watching the dashboard, I can see at a glance which agent sessions have finished their task and are waiting at the prompt for my next instruction — without opening each tmux session individually.
- [ ] As an operator, the amber indicator fires within one supervisor sweep cycle (≤30s) of the agent reaching its idle prompt, and clears within one cycle of the agent resuming work.
- [ ] As a maintainer adding support for a new agent CLI, I can define its idle-prompt detection pattern by adding a single `idleDetection` block to `templates/agents/<id>.json` — no changes to the supervisor or dashboard are required.
- [ ] As an operator, the indicator distinguishes "agent idle at prompt" from "agent computing silently" — long LLM API calls do not trigger false positives.

## Acceptance Criteria

- [ ] `templates/agents/cc.json` has `idleDetection.idlePattern` matching Claude Code's `❯ \n────` idle prompt; `idleDetection.workingPattern` matching its active tool-call glyphs (`⏺`, `✻`).
- [ ] `templates/agents/gg.json` has `idleDetection.idlePattern` matching Gemini CLI's `"Type your message"` + `▄{10,}` input bar; `idleDetection.workingPattern` matching its spinner/tool glyphs.
- [ ] `templates/agents/cx.json` and `templates/agents/cu.json` have `idleDetection` blocks (or are explicitly left blank with a comment if no reliable pattern exists for that agent).
- [ ] `lib/supervisor.js` `sweepEntity()` runs `tmux capture-pane -S -8` for each alive agent session, applies the agent's `idleDetection` patterns, and stores `{ idleAtPrompt: bool, detectedAt: ISO }` under a new in-memory map (same lifecycle as `idleData` / `livenessData`).
- [ ] `lib/dashboard-status-collector.js` includes `idleAtPrompt` (boolean) per agent slot and `anyIdleAtPrompt` (boolean) at the row level, exactly paralleling the existing `awaitingInput` / `anyAwaitingInput` shape.
- [ ] Dashboard `index.html` applies `awaiting-input` class to kanban cards when `anyIdleAtPrompt` is true (in addition to the existing `anyAwaitingInput` condition).
- [ ] A `captureAndDetectIdle(sessionName, agentId)` helper lives in `lib/supervisor.js` (or a shared `lib/idle-detection.js`); it is the single call site. No other file imports `tmux capture-pane` for this purpose.
- [ ] `workingPattern`, when present, short-circuits idle detection: if the working pattern matches, `idleAtPrompt` is `false` regardless of the idle pattern.
- [ ] When no `idleDetection` block is defined for an agent, the feature degrades gracefully: no capture-pane call is made, `idleAtPrompt` is `false`.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` all pass.

## Validation

```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +30 LOC for idle-detection unit tests.
- May skip `npm run test:ui` when changes touch only `lib/` and `templates/agents/*.json` with no dashboard asset changes.

## Technical Approach

### Pattern definition — `templates/agents/<id>.json`

Add an `idleDetection` key alongside the existing `signals` and `failureDetectors` keys:

```jsonc
"idleDetection": {
  // Regex string (no delimiters). Matched against ANSI-stripped capture-pane output.
  // Should be specific enough to fire only when the agent is at its idle REPL prompt.
  "idlePattern": "❯\\s*\\n[─]{20,}",

  // Optional. If present and matches, overrides idlePattern to false.
  // Use to suppress false positives during long silent compute phases.
  "workingPattern": "[⏺✻⏳⏵]"
}
```

Agents without a reliable visual signature leave `idleDetection` absent. The supervisor checks for the key before calling `capture-pane`, so there is zero overhead for unsupported agents.

### Session → agentId mapping

The supervisor already has `agentId` in scope inside `sweepEntity()` (the `for (const [agentId, agent] of ...)` loop). `loadAgentConfig(agentId)` is available in scope. No new plumbing is needed.

### capture-pane call

```js
const result = runTmux(
  ['capture-pane', '-p', '-t', sessionName, '-S', '-8'],
  { encoding: 'utf8' }
);
const text = stripAnsi(result.stdout || '');
```

`-S -8` captures the last 8 lines — enough to include the prompt chrome without excessive output. Use the existing `stripAnsi` or a minimal inline implementation (replace `/\x1b\[[0-9;]*[a-zA-Z]/g`). The `capturePane` helper already exists in `nudge.js`; consider extracting it to `lib/tmux-utils.js` or duplicating locally rather than creating an indirect import dependency.

### State storage and write-path

Add a new in-memory `idleAtPromptData` Map with the same keying scheme as `idleData` (`${repoPath}:${entityType}:${entityId}:${agentId}`). Do **not** write to disk — this is derived state recomputed every sweep. The dashboard-status-collector reads it via a new exported getter (paralleling the existing `getAgentLivenessAndIdle`).

### Dashboard integration

`anyIdleAtPrompt` is true if any agent slot in the row has `idleAtPrompt: true`. The `awaiting-input` CSS class already applies the amber ring (`box-shadow: 0 0 0 1px rgba(245,158,11,.35)...`). Extend the `:class` binding in `index.html` to `OR` the new flag with the existing `anyAwaitingInput`:

```js
'awaiting-input': feature.anyAwaitingInput || feature.anyIdleAtPrompt
```

This reuses all existing visual treatment with zero new CSS.

### Confirmed patterns (from live session captures)

**Claude Code** (`cc`):
- Idle: last lines contain `❯ ` (U+276F, `\xe2\x9d\xaf`) followed within 2 lines by 20+ `─` (U+2500, `\xe2\x94\x80`) border
- Working: contains `⏺` (U+23FA) or `✻` (U+273B) on recent lines

**Gemini CLI** (`gg`):
- Idle: contains literal `"Type your message"` AND `▄▄▄▄▄▄▄▄▄▄` (U+2584 × 10+)
- Working: contains Gemini's spinner chars or `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` on recent lines

**Codex** (`cx`) and **Cursor** (`cu`): patterns to be confirmed at implementation time; leave `idleDetection` absent or with a `// TODO` comment in the JSON.

### Performance

~5ms per `tmux capture-pane` call. With 10 active sessions each having an `idleDetection` config, this adds ~50ms per 30-second supervisor cycle. Negligible. Guard with `if (!agentConfig.idleDetection) return null` so agents without config pay zero cost.

## Dependencies

- None. All required infrastructure (supervisor sweep, `loadAgentConfig`, `dashboard-status-collector`, `anyAwaitingInput` CSS treatment) already exists.

## Out of Scope

- Detecting mid-task tool-approval prompts (only relevant when NOT using `--permission-mode acceptEdits`; current Aigon sessions always use `acceptEdits`).
- OSC 133 / shell integration sequences — neither Claude Code nor Gemini CLI emit them.
- macOS process-level detection via `ps`/`lsof`/`dtrace` — cannot reliably distinguish TTY-blocked from network-I/O-blocked without root.
- Persisting `idleAtPrompt` state to disk — derived state only, recomputed each sweep.
- Desktop notifications on idle-at-prompt (separate concern; can be a follow-up using the same data).
- Adding idle-detection patterns for agents not yet supported (cx, cu) — defer to when those agents are actively used.

## Open Questions

- Extract `capturePane` to a shared `lib/tmux-utils.js` (cleaner) or duplicate inline in `lib/supervisor.js` (fewer deps)? Recommend extraction if two or more callers end up in different lib files.
- Should `anyIdleAtPrompt` use a separate CSS class / visual treatment from `anyAwaitingInput`, to distinguish "agent finished and waiting" from "agent blocked mid-task asking a question"? Current spec reuses the same amber ring for simplicity; implementation may decide to differentiate.

## Related

- Research: 40 — terminal-in-dashboard (surface that uncovered the capture-pane feasibility analysis)
- Set: (standalone)
