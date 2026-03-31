# Feature: Externalise All Model Defaults — No Hardcoded Models in Code

## Summary

Model names are hardcoded in **three places** that drift apart: `templates/agents/*.json`, `lib/config.js` `DEFAULT_GLOBAL_CONFIG`, and `~/.aigon/config.json`. Changing a model (e.g. `gemini-2.5-flash` → `gemini-2.5-pro`) requires editing all three, running `install-agent`, restarting the server, AND updating the global config file. We just hit this: the dashboard showed the old model after updating the template and code because the user's global config had its own saved copy. This feature makes `templates/agents/*.json` the single source of truth. Code defaults and user config inherit from it, not duplicate it.

## The Problem (what happened today)

1. Updated `templates/agents/gg.json` models to `gemini-2.5-pro` — dashboard still showed `flash`
2. Updated `lib/config.js` `DEFAULT_GLOBAL_CONFIG` — dashboard still showed `flash`
3. Ran `aigon install-agent gg` — dashboard still showed `flash`
4. Restarted server — dashboard still showed `flash`
5. Finally found `~/.aigon/config.json` had its own copy with `flash` — manually edited it
6. Three copies, three updates, five attempts to change one model name

## User Stories

- [ ] As a developer, I want to change a model in one file and have it take effect everywhere — dashboard, CLI, review picker, config screen
- [ ] As a user, I want the config screen to show the current model without needing a server restart
- [ ] As a developer, I want to add a new task type (e.g. `review`) without updating three files

## Acceptance Criteria

- [ ] `templates/agents/*.json` is the single source of truth for default model names
- [ ] `lib/config.js` `DEFAULT_GLOBAL_CONFIG` reads models from templates at require-time, not hardcoded
- [ ] `~/.aigon/config.json` only stores **user overrides** (the Override column in the config screen), not copies of defaults
- [ ] If `~/.aigon/config.json` has no override for a model, the template default is used
- [ ] The config screen shows Default (from template) + Override (from user config) + Effective (merged)
- [ ] Adding a new task type to `templates/agents/gg.json` (e.g. `review`) appears automatically in the config screen without code changes
- [ ] `node -c lib/config.js` passes
- [ ] No model name strings hardcoded anywhere in `lib/config.js`

## Validation

```bash
node -c lib/config.js
node -c lib/dashboard-server.js

# No hardcoded model strings in config.js DEFAULT_GLOBAL_CONFIG
if grep -A20 'DEFAULT_GLOBAL_CONFIG' lib/config.js | grep -q "'gemini\|'opus\|'sonnet\|'gpt\|'composer"; then
  echo "FAIL: hardcoded model strings still in DEFAULT_GLOBAL_CONFIG"
  exit 1
fi

# Templates are the source
node -e "
const cfg = require('./lib/config');
const tmpl = require('./templates/agents/gg.json');
const defaults = cfg.DEFAULT_GLOBAL_CONFIG || cfg.getDefaultConfig();
const ggModels = defaults.agents.gg.models;
const tmplModels = tmpl.cli.models;
if (ggModels.implement !== tmplModels.implement) {
  console.error('FAIL: config default does not match template');
  process.exit(1);
}
console.log('PASS: config reads from template');
"
```

## Technical Approach

### 1. Load models from templates in config.js

Replace the hardcoded `models: { ... }` in `DEFAULT_GLOBAL_CONFIG` with:

```js
function loadAgentModelDefaults() {
    const agents = {};
    for (const id of ['cc', 'gg', 'cx', 'cu', 'mv']) {
        try {
            const tmpl = require(`../templates/agents/${id}.json`);
            agents[id] = { ...agents[id], models: tmpl.cli.models };
        } catch (_) {}
    }
    return agents;
}
```

### 2. Clean up user config on load

When `loadGlobalConfig()` reads `~/.aigon/config.json`, strip any model values that match the template defaults — they're not overrides, they're stale copies. Only keep values that differ from the template.

### 3. Config screen shows merged view

The dashboard config screen already shows Default / Override / Effective. Ensure Default reads from the template (not `DEFAULT_GLOBAL_CONFIG`) and Override only shows values the user explicitly set.

### Key files:
- `lib/config.js` — remove hardcoded models, load from templates
- `lib/dashboard-server.js` — config API returns template defaults as the Default column
- `templates/agents/*.json` — already correct, no changes needed

## Dependencies

- None

## Out of Scope

- Changing which models are available (just changing where defaults are stored)
- CLI flag defaults (keep in config.js for now)
- Agent CLI binary paths (keep in config.js)

## Related

- The exact bug this fixes happened during feature 192 session (today)
- Feature 197: Profile Placeholders as Config (same pattern — data not code)
