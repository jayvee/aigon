---
updated: 2026-03-15T22:41:39.007Z
startedAt: 2026-02-25T14:42:33+11:00
completedAt: 2026-02-25T14:42:54+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 19 - model-selection-core

## Plan

Added `cli.models` config field to agent templates and merged it through the three-level config hierarchy (template → global → project), then injected `--model <value>` flags into agent CLI commands per task type.

## Progress

- `getAgentCliConfig()`: added `models` to the three-level merge (template → global → project), each level shallow-merging so individual keys can be overridden without wiping others
- `buildAgentCommand(wt, taskType = 'implement')`: added `taskType` param; builds `--model` flag from `cliConfig.models[taskType]`; skips for Cursor with console warning
- `buildResearchAgentCommand()`: same pattern, hardcoded to `'research'` task type
- `cc.json`: `research: opus`, `implement: sonnet`, `evaluate: sonnet`
- `gg.json`: `research: gemini-2.5-pro`, `implement: gemini-2.5-pro`, `evaluate: gemini-2.5-flash`
- `cx.json`: empty `models: {}` (user decides)
- `cu.json`: empty `models: {}` (warning emitted if user populates)

## Decisions

- Cursor warning instead of support: spec specified warn+skip based on research finding that `agent --model` isn't supported (though contradicted by cx/gg findings — trivially reversible)
- Empty `models: {}` in cx/cu templates rather than omitting the key entirely, to make the extension point discoverable
- Flags joined with `.filter(Boolean).join(' ')` to cleanly handle the case where either flag is absent
