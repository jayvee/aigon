# Implementation Log: Feature 201 - pluggable-agent-architecture-zero-hardcoded-agent-logic
Agent: cc

## Plan

1. Extend all 5 agent JSON schemas with new fields
2. Create `lib/agent-registry.js` as centralized lookup module
3. Replace hardcoded references across 13 files
4. Validate zero hardcoded agent logic remains

## Progress

- Extended `templates/agents/*.json` with: displayName, providerFamily, portOffset, trust, worktreeEnv, git, capabilities, installHint, defaultFleetAgent, legacy
- Created `lib/agent-registry.js` (~280 lines) — scans agent templates at require-time, caches results, provides all lookup functions
- Replaced 45+ hardcoded agent references across 13 files
- All syntax checks pass, all tests pass, validation script confirms zero hardcoded agent logic

## Decisions

- **Trust functions kept as thin wrappers**: `presetWorktreeTrust`, `presetGeminiTrust`, `presetCodexTrust` in worktree.js remain as one-line delegation to registry for backward compat with callers (feature-close.js, setup.js)
- **Trust config schema**: Three trust types (`claude-json`, `json-kv`, `toml-project`) cover all current agent trust mechanisms. `ensureAgentTrust()` dispatches via switch. `ensureSinglePathTrust()` handles individual worktree registration (uses direct `value` instead of `parentValue` for json-kv type)
- **`PROVIDER_FAMILIES` export**: Kept as a getter property in config.js exports for backward compat with feature.js which destructures it
- **Capabilities model**: Added `supportsModelFlag` and `transcriptTelemetry` to agent capabilities. Replaces `resolvedAgent === 'cu'` and `agentId === 'cc'` checks
- **`solo` pseudo-agent**: Not added to templates — it's a mode, not an agent. Kept as special case alongside registry calls (`|| agentId === 'solo'`)
- **Port offsets used for sort order**: Terminal adapter window ordering now derives from portOffset instead of a separate hardcoded ORDER map
- **Default fleet agents**: Added `defaultFleetAgent: true` to cc.json and gg.json. `getDefaultFleetAgents()` returns these sorted by portOffset
- **buildDefaultAgentConfigs()** generates `DEFAULT_GLOBAL_CONFIG.agents` from templates at require-time — no model name strings in config.js

## Issues

- `PROVIDER_FAMILIES` was still referenced in config.js exports after removing the const — fixed with getter property
- No other issues encountered
