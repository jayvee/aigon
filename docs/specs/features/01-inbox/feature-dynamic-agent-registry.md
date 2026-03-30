# Feature: dynamic-agent-registry

## Summary

Replace hardcoded agent lists throughout the codebase with a single dynamic agent registry. The registry loads available agents from `templates/agents/*.json` and filters by `disabled` config, so adding a new agent or disabling one for a specific installation requires zero code changes to the dashboard, CLI, or templates.

## Motivation

Agent IDs (`cc`, `gg`, `cx`, `cu`, `mv`) are hardcoded in at least 8 locations:
- `templates/dashboard/index.html` — agent picker modal (HTML checkboxes)
- `templates/dashboard/js/actions.js` — `AGENT_DISPLAY_NAMES` map
- `lib/config.js` — port offsets (`agentOffsets`), profile presets (`ports`)
- `lib/utils.js` — `AGENT_CONFIGS` or similar agent enumeration
- `lib/worktree.js` — Warp config agent list
- `lib/commands/infra.js` — `agentOrder` for sorting
- `lib/commands/feature.js` — `agentOrder` for sorting
- `site/content/reference/agents.mdx` — docs agent table

When feature 144 added Mistral Vibe (`mv`), every one of these needed manual updates. When a user wants to disable Cursor (`cu`) for their installation, there's no single config — they'd have to hope each surface respects the same flag.

## User Stories
- [ ] As a developer adding a new agent, I want to add one `templates/agents/{id}.json` file and have it appear everywhere — dashboard picker, CLI, port allocation, docs
- [ ] As a user, I want to disable an agent (e.g., `cu`) via config and have it disappear from the dashboard agent picker and CLI suggestions
- [ ] As a user, I want the dashboard agent picker to show only agents relevant to my installation

## Acceptance Criteria
- [ ] Single registry module (`lib/agents.js` or extend `lib/config.js`) that enumerates agents from `templates/agents/*.json`
- [ ] Registry exposes: `getAvailableAgents()` (all known), `getEnabledAgents()` (filtered by `disabled` config)
- [ ] Dashboard agent picker modal is generated dynamically from the registry (not hardcoded HTML)
- [ ] `AGENT_DISPLAY_NAMES` in `actions.js` is populated from the registry (served via API or embedded in page data)
- [ ] Port offsets (`agentOffsets`) derived from the registry rather than a hardcoded map
- [ ] `agents.{id}.disabled: true` in global or project config hides the agent from all surfaces
- [ ] Dashboard agent picker is **per-repo aware** — only shows agents installed in the selected repo (detected via `docs/agents/{id}.md` or agent config dirs like `.claude/`, `.gemini/`)
- [ ] Dashboard serves installed agents via API endpoint (e.g., `GET /api/agents?repo=/path/to/repo`) so the picker is dynamic
- [ ] `aigon doctor` lists enabled/disabled agents
- [ ] Adding a new agent requires only: `templates/agents/{id}.json` with `displayName`, `cli`, `portOffset`

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### Registry module

Extend `lib/config.js` or create `lib/agents.js`:

```js
function getAvailableAgents() {
    // Scan templates/agents/*.json for agent definitions
    // Each defines: id, displayName, cli, portOffset, implementFlag
    return agentDefs;
}

function getEnabledAgents() {
    return getAvailableAgents().filter(a => !isAgentDisabled(a.id));
}
```

### Agent template schema extension

Add to each `templates/agents/{id}.json`:
```json
{
  "displayName": "Claude Code",
  "portOffset": 1,
  "slashPrefix": "/aigon:"
}
```

### Dashboard dynamic picker

Replace the hardcoded `<label>` elements in `index.html` with a server-rendered or API-driven list. Options:
1. AIGON server injects the agent list into the HTML at serve time (simplest)
2. Dashboard fetches `/api/agents` and builds the picker dynamically

### Port offset derivation

Replace `{ cc: 1, gg: 2, cx: 3, cu: 4, mv: 5 }` with registry-driven offsets read from agent configs.

## Dependencies
- None (uses existing `templates/agents/*.json` files and `isAgentDisabled()` from config)

## Out of Scope
- Auto-discovery of installed agent CLIs (that's `aigon doctor`'s job)
- Agent capability negotiation (all agents get the same commands)
- Per-project agent enablement (start with global config only)

## Open Questions
- Should the dashboard serve the agent list via API or embed it in the HTML template?
- Should disabled agents be completely hidden or shown greyed-out with a "disabled" badge?

## Related
- Feature 144 (Mistral Vibe): demonstrated the pain of adding a new agent manually
- `isAgentDisabled()` in `lib/config.js`: already implemented, needs consumers
