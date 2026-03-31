# Feature: Pluggable Agent Architecture — Zero Hardcoded Agent Logic

## Summary

Agent-specific logic is scattered across the codebase as if/else chains: `if (agentId === 'gg') presetGeminiTrust(...)`, `if (agentId === 'cx') presetCodexTrust(...)`. Adding Mistral Vibe required 5 separate `fix(review)` commits touching 4 files. The current audit shows **45+ hardcoded agent references** across `lib/config.js`, `lib/worktree.js`, `lib/dashboard-server.js`, `lib/git.js`, `lib/commands/feature.js`, and `lib/profile-placeholders.js`. This feature moves all agent-specific behaviour into `templates/agents/{id}.json` so the runtime code is agent-agnostic. Adding a new agent means creating one JSON file — zero code changes.

## The Problem

Every agent (cc, gg, cx, cu, mv) has its logic spread across multiple files:

| Concern | Where it lives now | How many files |
|---------|-------------------|----------------|
| Trust/permissions setup | `worktree.js` (3 functions), `feature.js` (3 if/else), `dashboard-server.js` (2 if/else) | 3 |
| Display name | `dashboard-server.js` line 552 (`AGENT_DISPLAY_NAMES` map) | 1 |
| Model defaults | `config.js` `DEFAULT_GLOBAL_CONFIG` (hardcoded per agent) | 1 |
| CLI binary + flags | `config.js` (hardcoded per agent) | 1 |
| Port offsets | `profile-placeholders.js` line 197 (`agentOffsets` map) | 1 |
| Provider family | `config.js` line 190 (`PROVIDER_FAMILIES` map) | 1 |
| Git attribution regex | `git.js` lines 6-7 (hardcoded regex with agent IDs) | 1 |
| Known agent set | `git.js` line 11 (`KNOWN_AGENT_IDS` set) | 1 |
| Help text examples | `feature.js` (hardcoded `cc gg cx cu` in usage strings) | 1 |

**Total: 45+ references, 7 files.** Adding one agent = touching all 7.

## User Stories

- [ ] As a developer, I want to add a new agent by creating one config file and running `install-agent` — no code changes
- [ ] As a maintainer, I want all behaviour for agent `gg` to live in `templates/agents/gg.json` — not scattered across 7 files
- [ ] As a user, I want the dashboard config screen, CLI help, and trust setup to automatically reflect any agent defined in `templates/agents/`

## Acceptance Criteria

### Agent config is complete and self-describing
- [ ] `templates/agents/{id}.json` contains ALL agent-specific data: display name, CLI binary, flags, models, provider family, port offset, trust mechanism, git attribution email pattern
- [ ] Example for gg:
```json
{
  "id": "gg",
  "displayName": "Gemini",
  "providerFamily": "google",
  "portOffset": 2,
  "cli": {
    "command": "gemini",
    "implementFlag": "--yolo",
    "models": { "research": "gemini-2.5-pro", "implement": "gemini-2.5-pro", "evaluate": "gemini-2.5-pro", "review": "gemini-2.5-pro" }
  },
  "trust": {
    "type": "json-array",
    "path": "~/.gemini/trustedFolders.json",
    "key": "path",
    "value": "TRUST_FOLDER"
  },
  "worktreeEnv": {
    "GEMINI_CLI_IDE_WORKSPACE_PATH": "{worktreePath}"
  },
  "git": {
    "emailPattern": "gg@aigon.dev"
  }
}
```

### Runtime code is agent-agnostic
- [ ] No `if (agentId === 'gg')` or `if (agentId === 'cx')` anywhere in `lib/`
- [ ] No hardcoded agent ID arrays (`['cc', 'gg', 'cx', 'cu', 'mv']`) in `lib/`
- [ ] `AGENT_DISPLAY_NAMES` map in `dashboard-server.js` is generated from templates at startup
- [ ] `DEFAULT_GLOBAL_CONFIG.agents` in `config.js` is generated from templates at startup
- [ ] `PROVIDER_FAMILIES` map in `config.js` is generated from templates
- [ ] `AI_AGENT_IDS` and `KNOWN_AGENT_IDS` in `git.js` are generated from templates
- [ ] `agentOffsets` in `profile-placeholders.js` is generated from templates
- [ ] Trust setup is a single function: `ensureAgentTrust(agentId, paths)` that reads trust config from the agent's JSON
- [ ] Worktree env overrides are a single function: `getWorktreeEnvExports(agentId, worktreePath)` that reads `worktreeEnv` from the agent's JSON and returns shell export statements — no hardcoded `GEMINI_CLI_IDE_WORKSPACE_PATH` in `worktree.js`
- [ ] The hardcoded `export GEMINI_CLI_IDE_WORKSPACE_PATH` in `buildRawAgentCommand()` is replaced by the generic `worktreeEnv` handler

### Discovery is automatic
- [ ] Available agents are discovered by scanning `templates/agents/*.json` at startup
- [ ] The dashboard config screen shows all discovered agents
- [ ] CLI help text generates agent examples from discovered agents
- [ ] `aigon install-agent` lists all available agents from templates

### Verification
- [ ] No regression in existing agent behaviour (cc, gg, cx, cu, mv all work identically)
- [ ] Adding a hypothetical agent `test-agent` with just a JSON file is demonstrably possible without code changes

## Validation

```bash
node -c aigon-cli.js
node -c lib/config.js
node -c lib/worktree.js
node -c lib/dashboard-server.js
node -c lib/git.js

# Zero hardcoded agent ID checks in lib/
if grep -rn "=== 'cc'\|=== 'gg'\|=== 'cx'\|=== 'cu'\|=== 'mv'" lib/ --include='*.js' | grep -v test | grep -v node_modules | grep -q .; then
  echo "FAIL: hardcoded agent ID checks still exist"
  grep -rn "=== 'cc'\|=== 'gg'\|=== 'cx'\|=== 'cu'\|=== 'mv'" lib/ --include='*.js' | grep -v test | grep -v node_modules
  exit 1
fi

# Zero hardcoded agent arrays
if grep -rn "\['cc'.*'gg'\|'cc'.*'gg'.*'cx'" lib/ --include='*.js' | grep -v test | grep -v node_modules | grep -q .; then
  echo "FAIL: hardcoded agent arrays still exist"
  exit 1
fi

echo "PASS: no hardcoded agent logic"
```

## Technical Approach

### 1. Extend agent JSON schema

Add `displayName`, `providerFamily`, `portOffset`, `trust`, and `git` sections to each `templates/agents/{id}.json`. The `cli` and `models` sections already exist.

### 2. Create `lib/agent-registry.js` (~100 lines)

Single module that:
- Scans `templates/agents/*.json` at require-time
- Builds lookup maps: `getAgent(id)`, `getAllAgentIds()`, `getAgentDisplayName(id)`, `getAgentPortOffset(id)`, `getAgentProviderFamily(id)`
- Provides `ensureAgentTrust(agentId, paths)` that reads trust config and dispatches to the right handler
- Trust handlers are a small map: `{ "json-array": writeJsonArrayTrust, "toml-path": writeTomlTrust, "claude-settings": writeClaudePermissions }`

### 3. Replace hardcoded references

For each of the 7 files, replace the hardcoded maps/arrays/if-chains with calls to `agent-registry.js`:

- `config.js`: `DEFAULT_GLOBAL_CONFIG.agents` → `agentRegistry.buildDefaultAgentConfigs()`
- `dashboard-server.js`: `AGENT_DISPLAY_NAMES` → `agentRegistry.getDisplayNames()`
- `git.js`: `AI_AGENT_IDS`, `KNOWN_AGENT_IDS` → `agentRegistry.getAllAgentIds()`
- `profile-placeholders.js`: `agentOffsets` → `agentRegistry.getPortOffsets()`
- `worktree.js`: delete `presetGeminiTrust`, `presetCodexTrust`, `presetWorktreeTrust` → `agentRegistry.ensureAgentTrust(id, paths)`
- `feature.js`: delete all `if (agentId === ...)` trust blocks → `agentRegistry.ensureAgentTrust(agentId, paths)`
- `dashboard-server.js`: same

### 4. Help text

Replace hardcoded `cc gg cx cu` in usage strings with `agentRegistry.getAllAgentIds().join(' ')`.

### Key files to modify:
- NEW: `lib/agent-registry.js` (~100 lines)
- `templates/agents/*.json` — extend schema
- `lib/config.js` — remove hardcoded agent block
- `lib/worktree.js` — remove 3 trust functions, use registry
- `lib/dashboard-server.js` — remove display names map, trust if/else
- `lib/git.js` — remove hardcoded agent sets
- `lib/profile-placeholders.js` — remove hardcoded offsets
- `lib/commands/feature.js` — remove trust if/else chains

## Dependencies

- None (this subsumes feature 200 — externalise model defaults)

## Out of Scope

- Adding new agents (this enables it, doesn't do it)
- Changing agent behaviour (pure extraction, no behavioural changes)
- Template/command file generation (already handled by `install-agent`)

## Related

- Feature 200: Externalise Model Defaults (subsumed by this — models become part of agent JSON)
- Feature 194: Command Config Runner (same data-over-code philosophy)
- The Mistral Vibe integration that required 5 fix(review) commits across 4 files
