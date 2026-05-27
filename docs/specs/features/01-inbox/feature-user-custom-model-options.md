---
complexity: medium
---

# Feature: user-custom-model-options

## Summary
Allow end-users to add their own model options (e.g. local Ollama models, custom OpenRouter endpoints) to any agent's dashboard model picker via `.aigon/config.json` (project-level) or `~/.aigon/config.json` (global). Today `getModelOptions()` reads exclusively from the shipped `templates/agents/<id>.json` `modelOptions` array — there is no extension point for user-specific models. Local models are inherently per-user (different hardware, different models pulled, different provider configs), so they cannot live in the shipped agent templates.

## User Stories
- [ ] As a developer running Ollama locally, I can add my local model to `~/.aigon/config.json` so it appears in the dashboard model dropdown for the OpenCode agent — without editing any Aigon source files.
- [ ] As a team lead, I can add a team-specific OpenRouter model to `.aigon/config.json` so all team members see it in their dashboard when working on this project.
- [ ] As a developer with multiple local models, I can list several custom models and they all appear at the top of the dropdown, above the shipped defaults.

## Acceptance Criteria
- [ ] New config key `agents.<agentId>.customModelOptions` accepted in both project (`.aigon/config.json`) and global (`~/.aigon/config.json`) config files.
- [ ] Shape matches existing `modelOptions` entries: `{ value, label, pricing?, notes?, score? }`. Only `value` and `label` are required.
- [ ] `getModelOptions()` in `agent-registry.js` merges custom models **before** shipped models (user models appear first in dropdown).
- [ ] Merge precedence: project config > global config > shipped `op.json`. Duplicates by `value` are deduplicated (first wins).
- [ ] `isKnownModelValue()` accepts custom model values without requiring them in the shipped array.
- [ ] Dashboard bootstrap payload (`getAgentBootstrapData`) includes merged model options.
- [ ] `aigon config` can read/write `customModelOptions` entries (or at minimum, the JSON is hand-editable and validated on load).
- [ ] Existing behaviour is unchanged when no `customModelOptions` key is present.

## Validation
```bash
node -e "
const { getModelOptions } = require('./lib/agent-registry');
const opts = getModelOptions('op');
console.log('model count:', opts.length);
process.exit(opts.length > 0 ? 0 : 1);
"
```

## Technical Approach

### Read path changes (agent-registry.js)
`getModelOptions(agentId)` currently reads only `agent.cli.modelOptions`. Change it to:
1. Load project config and global config (via existing `loadProjectConfig()` / `loadGlobalConfig()` from `lib/config.js`).
2. Collect `customModelOptions` arrays: `[...projectConfig.agents?.[agentId]?.customModelOptions, ...globalConfig.agents?.[agentId]?.customModelOptions]`.
3. Prepend to the shipped `modelOptions`, deduplicating by `value` (first occurrence wins).
4. Return the merged list.

The same merge must be reflected in `getAgentBootstrapData()` (line ~637) which currently reads `agent.cli.modelOptions` directly — it should call `getModelOptions()` instead of re-reading the raw array.

### isKnownModelValue
Already handles unknown models permissively when `concreteOptions` is empty. With merged custom options, user models will be in the concrete list, so no change needed — they'll pass validation naturally.

### Config shape
```json
// ~/.aigon/config.json (global) or .aigon/config.json (project)
{
  "agents": {
    "op": {
      "customModelOptions": [
        {
          "value": "ollama/devstral:24b",
          "label": "Devstral 24B via Ollama (local)",
          "pricing": { "input": 0, "output": 0 }
        }
      ]
    }
  }
}
```

### What NOT to change
- No changes to `op.json` or any shipped agent template.
- No new CLI commands — users hand-edit JSON (consistent with existing `.aigon/config.json` patterns like `agents.<id>.disabled`).
- No validation of whether the model actually exists in the user's OpenCode/Ollama setup — Aigon passes the string through; the agent runtime owns that concern.

## Dependencies
- depends_on: none

## Out of Scope
- Auto-detecting locally available Ollama models.
- A CLI wizard for adding custom models (hand-edit JSON is fine for v1).
- Validating that the custom model's provider is configured in OpenCode.
- Adding custom models for non-OpenCode agents (the mechanism is generic, but the use case is `op` for now).

## Open Questions
- None — the `agents.<agentId>.*` config namespace already exists and this follows the established pattern.

## Related
- Feature spec: `test-local-model-via-opencode` (paused) — the validation task that surfaced this need
- Research: R25 — OpenCode comparison (confirmed OpenCode supports local Ollama)
