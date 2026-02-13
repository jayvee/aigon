# Feature: Agent CLI Flag Overrides

## Summary

Currently, Aigon uses "yolo mode" CLI flags by default for all agents (e.g., `--force` for Cursor, `--sandbox --yolo` for Gemini) that auto-approve commands. This is convenient for development but may be too permissive for corporate environments requiring stricter security controls. This feature allows users to override these default CLI flags via configuration files, enabling manual permission prompts when needed.

## User Stories

- [ ] As a developer in a corporate environment, I want to disable auto-approval flags so agents require manual permission prompts for each action
- [ ] As a developer, I want to set stricter defaults globally in `~/.aigon/config.json` for all my projects
- [ ] As a developer, I want to override flags per-project in `.aigon/config.json` for project-specific security requirements
- [ ] As a developer, I want to understand which flags are used by default so I can make informed security decisions

## Acceptance Criteria

- [ ] `getAgentCliConfig()` checks project config (`.aigon/config.json`) first, then global config (`~/.aigon/config.json`), then template defaults
- [ ] Setting `agents.{id}.implementFlag` to `""` (empty string) removes auto-approval flags and requires manual prompts
- [ ] Setting `agents.{id}.implementFlag` to a custom value overrides the default flag
- [ ] `aigon config init` shows examples of safer defaults for corporate environments
- [ ] `aigon config show` displays current flag settings
- [ ] Documentation explains the feature, default flags, and how to override them
- [ ] Help command template mentions config overrides

## Technical Approach

### Default Settings Location

Default CLI flags are defined in agent template files:
- `templates/agents/cc.json`: `"implementFlag": "--permission-mode acceptEdits"`
- `templates/agents/cu.json`: `"implementFlag": "--force"`
- `templates/agents/gg.json`: `"implementFlag": "--sandbox --yolo"`
- `templates/agents/cx.json`: `"implementFlag": "--full-auto"`

### Override Settings Location

Users can override flags in two places (priority order):

1. **Project config** (`.aigon/config.json`) - Highest priority, project-specific
2. **Global config** (`~/.aigon/config.json`) - User-wide defaults
3. **Template defaults** (`templates/agents/{id}.json`) - Fallback

### Implementation

#### 1. Update `getAgentCliConfig()` function (`aigon-cli.js` ~line 312)

Modified to check both global and project configs for `implementFlag` override:

```javascript
function getAgentCliConfig(agentId) {
    const agentConfig = loadAgentConfig(agentId);
    const globalConfig = loadGlobalConfig();
    const projectConfig = loadProjectConfig();

    // Start with defaults from agent config
    const cli = agentConfig?.cli || { command: agentId, implementFlag: '', implementPrompt: '' };

    // Override from global config (user-wide defaults)
    if (globalConfig.agents?.[agentId]) {
        if (globalConfig.agents[agentId].cli) {
            cli.command = globalConfig.agents[agentId].cli;
        }
        if (globalConfig.agents[agentId].implementFlag !== undefined) {
            cli.implementFlag = globalConfig.agents[agentId].implementFlag;
        }
    }

    // Override from project config (highest priority - project-specific, overrides global)
    if (projectConfig.agents?.[agentId]) {
        if (projectConfig.agents[agentId].cli) {
            cli.command = projectConfig.agents[agentId].cli;
        }
        if (projectConfig.agents[agentId].implementFlag !== undefined) {
            cli.implementFlag = projectConfig.agents[agentId].implementFlag;
        }
    }

    return cli;
}
```

#### 2. Update `aigon config init` command (`aigon-cli.js` ~line 3522)

Enhanced to show examples and explain flag overrides:

```javascript
console.log(`   You can customize:`);
console.log(`   - terminal: Terminal to use (warp, code, cursor)`);
console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
console.log(`   - agents.{id}.implementFlag: Override CLI flags for stricter permissions`);
console.log(`\n   Example (corporate/safer defaults):`);
console.log(`   {`);
console.log(`     "terminal": "warp",`);
console.log(`     "agents": {`);
console.log(`       "cc": { "cli": "claude", "implementFlag": "" },`);
console.log(`       "cu": { "cli": "agent", "implementFlag": "" },`);
console.log(`       "gg": { "cli": "gemini", "implementFlag": "--sandbox" },`);
console.log(`       "cx": { "cli": "codex", "implementFlag": "" }`);
console.log(`     }`);
console.log(`   }`);
```

#### 3. Documentation Updates

- `docs/GUIDE.md`: Added "CLI Flag Overrides" section explaining the feature
- `templates/generic/commands/help.md`: Added note about config overrides

### Example Configurations

#### Global Config (`~/.aigon/config.json`) - Corporate/Safer Defaults

```json
{
  "terminal": "warp",
  "agents": {
    "cc": { "cli": "claude", "implementFlag": "" },
    "cu": { "cli": "agent", "implementFlag": "" },
    "gg": { "cli": "gemini", "implementFlag": "--sandbox" },
    "cx": { "cli": "codex", "implementFlag": "" }
  }
}
```

This removes auto-approval flags globally, requiring manual permission prompts.

#### Project Config (`.aigon/config.json`) - Project-Specific Override

```json
{
  "profile": "web",
  "agents": {
    "cu": { "implementFlag": "" }
  }
}
```

This overrides Cursor's flag for this project only, even if global config has `--force`.

## Dependencies

- Existing config system (`loadGlobalConfig()`, `loadProjectConfig()`)
- `getAgentCliConfig()` function used by `worktree-open` and `research-open`

## Out of Scope

- Per-command flag overrides (flags apply to all commands using the agent)
- Environment variable overrides for flags (only terminal has env var override)
- Flag validation (invalid flags will be passed through to agent CLI)
- UI for managing flags (config files only)

## Open Questions

- Should we validate flag syntax or just pass through to agent CLI?
- Should we support partial flag overrides (e.g., add `--sandbox` but remove `--yolo`)?

## Related

- `feature-worktree-open-terminal.md` - Uses `getAgentCliConfig()` to build agent commands
- `feature-research-open-arena.md` - Uses `getAgentCliConfig()` for research commands
- Default flags defined in `templates/agents/{id}.json` files
