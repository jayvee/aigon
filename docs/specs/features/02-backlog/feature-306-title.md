# Feature: defaultAgent config — replace all hardcoded agent fallbacks

## Summary

Introduce a `defaultAgent` key in `~/.aigon/config.json` (global) and `.aigon/config.json` (per-project) so that users who don't have Claude Code, or who prefer a different agent, can configure which agent is used for every operation that currently silently falls back to `'cc'`. There are 16 such locations in the codebase today, all unsettable without patching code.

## User Stories

- [ ] As a Codex-only user, I want to set `"defaultAgent": "cx"` once in my global config so that close-with-agent, feature-eval, feature-code-review, and all other one-off operations use Codex instead of Claude Code.
- [ ] As a team operator, I want to set `"defaultAgent": "gg"` in `.aigon/config.json` so that every developer on the project gets Gemini as the default without configuring their own `~/.aigon/config.json`.
- [ ] As a user, I want `aigon feature-eval` (with no `--agent` flag) to use my configured default agent, not always Claude Code.
- [ ] As a user, I want the dashboard "Close with agent" button to open my preferred agent, not always the first worktree agent found.

## Acceptance Criteria

- [ ] `DEFAULT_GLOBAL_CONFIG` in `lib/config.js` includes `"defaultAgent": "cc"` as the built-in default
- [ ] `getDefaultAgent(repoPath?)` helper exported from `lib/config.js` reads project config → global config → built-in default, returns a valid registered agent ID
- [ ] All 16 hardcoded `'cc'` / `agents[0]` fallback sites replaced with `getDefaultAgent()` calls (see Technical Approach for full list)
- [ ] Dashboard settings UI exposes a "Default agent" dropdown under the General section (all registered agents as options)
- [ ] `aigon doctor` warns if `defaultAgent` is set to an agent that is not installed
- [ ] `node -c` passes on all edited files; `npm test` passes; `MOCK_DELAY=fast npm run test:ui` passes

## Validation

```bash
node -c lib/config.js
node -c lib/commands/feature.js
node -c lib/commands/entity-commands.js
node -c lib/validation.js
node -c lib/dashboard-routes.js
node -c lib/dashboard-server.js
npm test
```

## Pre-authorised

- May update DASHBOARD_SETTINGS_SCHEMA and the dashboard settings UI to add the defaultAgent dropdown without stopping to ask.
- May skip `npm run test:ui` if only `lib/` files are changed and no dashboard templates are touched.

## Technical Approach

### Step 1 — `getDefaultAgent()` helper in `lib/config.js`

Add to `DEFAULT_GLOBAL_CONFIG`:
```js
defaultAgent: 'cc',
```

Add exported helper:
```js
function getDefaultAgent(repoPath) {
    const project = loadProjectConfig(repoPath || process.cwd());
    if (project.defaultAgent) return String(project.defaultAgent).toLowerCase();
    const global = loadGlobalConfig();
    if (global.defaultAgent) return String(global.defaultAgent).toLowerCase();
    return DEFAULT_GLOBAL_CONFIG.defaultAgent; // 'cc'
}
```

Export it alongside `getAgentCliConfig`, `loadGlobalConfig`, etc.

### Step 2 — Replace all 16 hardcoded fallback sites

**`lib/commands/entity-commands.js` line 67**
```js
// Before:
function resolveReviewAgentFromOptions(options, ctx, fallbackAgent = 'cc') {
// After:
function resolveReviewAgentFromOptions(options, ctx, fallbackAgent) {
    if (!fallbackAgent) fallbackAgent = getDefaultAgent(ctx && ctx.repoPath);
```

**`lib/validation.js` line 357**
```js
// Before:
const selectedAgentRaw = String(utils.getOptionValue(options, 'agent') || 'cc').toLowerCase();
// After:
const selectedAgentRaw = String(utils.getOptionValue(options, 'agent') || getDefaultAgent(repoPath)).toLowerCase();
```

**`lib/commands/feature.js` line 1414** — `feature-open` drive mode:
```js
resolvedAgent = getDefaultAgent(repoPath);
```

**`lib/commands/feature.js` line 1716** — `feature-eval` default evaluator:
```js
let resolvedAgent = getDefaultAgent(repoPath);
```

**`lib/commands/feature.js` lines 2851, 3503** — autonomous fleet eval agent default:
Keep `agentIds[0]` as fallback here — the eval agent in fleet mode should default to the first implementation agent (cross-agent review), not the global default. No change.

**`lib/commands/feature.js` line 1225** — conductor trust seeding:
Keep `'cc'` hardcoded — this is structural, not a user-selectable operation. No change.

**`lib/dashboard-routes.js` lines 186, 195** — `close-resolve` agentId inference:
After inferring from the worktree regex/status data, if still empty fall back to `getDefaultAgent(absRepo)` instead of hitting the 400 guard. The 400 guard remains as the last resort.

**`lib/dashboard-routes.js` line 663** — `/api/ask` fallback:
```js
const agentId = String(payload.agentId || getDefaultAgent(absRepo)).trim();
```

**`lib/feature-status.js` line 291** — solo transcript telemetry:
Keep `'cc'` — this is a data-lookup fallback for legacy solo entries, not an operational default. No change.

**`lib/feature-status.js` line 413** — `primaryAgent`:
Keep `agents[0]` — the primary agent for status display should be the one that actually worked on the feature, not the user's default. No change.

**Dashboard UI — `actions.js` line 962** — autonomous modal pre-check:
```js
checked: agentId === (window.__AIGON_DEFAULT_AGENT__ || 'cc'),
```
Inject `__AIGON_DEFAULT_AGENT__` from the server alongside `__AIGON_AGENTS__`.

**Dashboard UI — `sidebar.js` line 13** — ask agent fallback:
```js
return ASK_AGENTS[0] ? ASK_AGENTS[0].id : (window.__AIGON_DEFAULT_AGENT__ || 'cc');
```

**Dashboard UI — `pipeline.js` line 124** — feature-create fallback:
```js
const agentId = (agentRadio && agentRadio.value) || (typeof getAskAgent === 'function' && getAskAgent()) || window.__AIGON_DEFAULT_AGENT__ || 'cc';
```

### Step 3 — Dashboard settings UI

Add to `DASHBOARD_SETTINGS_SCHEMA` in `lib/dashboard-server.js`:
```js
{
    key: 'defaultAgent',
    label: 'Default agent',
    description: 'Agent used when none is explicitly selected (close-with-agent, feature-eval, code-review, etc.)',
    type: 'select',
    scope: 'global',
    options: () => agentRegistry.getAllAgentIds(),
    default: 'cc',
}
```

Render as a dropdown in the General section of the settings panel.

### Step 4 — `aigon doctor` warning

In the doctor check that validates agent installation, also warn if `config.defaultAgent` is set to an agent ID that is not installed/registered:
```
⚠ defaultAgent is set to 'cx' but Codex is not installed (codex not found in PATH)
```

### Step 5 — Inject `__AIGON_DEFAULT_AGENT__` into the dashboard HTML

In `buildDashboardHtml()`, add:
```js
.replace('${AIGON_DEFAULT_AGENT}', () => JSON.stringify(getDefaultAgent()))
```
And in `index.html`:
```html
<script>window.__AIGON_DEFAULT_AGENT__ = ${AIGON_DEFAULT_AGENT};</script>
```

## Dependencies

- None — self-contained config change

## Out of Scope

- Per-agent-operation defaults (e.g. `defaultEvalAgent`, `defaultReviewAgent`) — a single `defaultAgent` covers 90% of the value; per-operation overrides can come later
- `conductor.defaultAgents` (array) for fleet operations — that already exists and is separate
- Changing hardcoded `'cc'` in trust-seeding and telemetry paths — these are structural/legacy, not user-facing defaults
- Auto-detecting which agents are installed and auto-selecting — too complex for this feature

## Open Questions

- Should project-level `defaultAgent` in `.aigon/config.json` override global, or should global win? (Proposed: project wins — same precedence as all other config keys)
- Should the `agentIds[0]` in autonomous fleet eval default stay as-is (cross-agent review intent) or also respect `defaultAgent`?

## Related

- Research: audit of all 16 hardcoded agent fallback sites (conducted 2026-04-22, results in feature-close-with-agent session)
- Feature: close-with-agent (F306 area) — the `close-resolve` mode is the immediate trigger for this feature
