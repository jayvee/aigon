# Feature: Base Port Configuration

## Summary
When multiple Aigon-managed projects run agent worktrees simultaneously, their dev server ports clash because all web projects default to the same range (cc=3001, gg=3002, cx=3003, cu=3004). Users must manually list all four agent ports in `.aigon/config.json` to avoid collisions. This feature adds a `basePort` shorthand so users can write `"basePort": 3800` and Aigon auto-calculates agent ports as `basePort + offset` (3801, 3802, 3803, 3804).

## User Stories
- [ ] As a developer working on multiple Aigon projects simultaneously, I want each project to use a unique port range so agent dev servers don't clash
- [ ] As a developer configuring a new project, I want to set a single `basePort` number instead of manually listing all four agent ports

## Acceptance Criteria
- [ ] Setting `arena.basePort` in `.aigon/config.json` auto-generates agent ports as `basePort + 1` (cc), `basePort + 2` (gg), `basePort + 3` (cx), `basePort + 4` (cu)
- [ ] `aigon profile show` displays the auto-generated ports correctly
- [ ] Worktrees created with `aigon feature-setup` write the correct auto-generated PORT to `.env.local`
- [ ] Explicit `arena.ports` still works and takes precedence over `basePort` for any agent specified in both
- [ ] If both `basePort` and `ports` are provided, `ports` entries override `basePort`-derived values for those specific agents
- [ ] The `basePort` value itself (e.g., 3800) is reserved for the main repo dev server — agents start at `basePort + 1`
- [ ] `aigon profile show` output distinguishes between auto-detected defaults and `basePort`-derived ports

## Technical Approach

### Single file change: `aigon-cli.js`

#### 1. Modify `getActiveProfile()` (~line 285)

Current code:
```javascript
if (projectConfig.arena) {
    if (projectConfig.arena.testInstructions) {
        profile.testInstructions = projectConfig.arena.testInstructions;
    }
    if (projectConfig.arena.ports) {
        profile.devServer.ports = { ...profile.devServer.ports, ...projectConfig.arena.ports };
    }
}
```

New code:
```javascript
if (projectConfig.arena) {
    if (projectConfig.arena.testInstructions) {
        profile.testInstructions = projectConfig.arena.testInstructions;
    }
    // Support basePort auto-calculation: basePort + offset per agent
    if (projectConfig.arena.basePort) {
        const base = projectConfig.arena.basePort;
        const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
        const autoPorts = {};
        for (const [agentId, offset] of Object.entries(agentOffsets)) {
            autoPorts[agentId] = base + offset;
        }
        profile.devServer.ports = { ...profile.devServer.ports, ...autoPorts };
    }
    // Explicit ports override basePort-derived values
    if (projectConfig.arena.ports) {
        profile.devServer.ports = { ...profile.devServer.ports, ...projectConfig.arena.ports };
    }
}
```

Note: both `basePort` and `ports` are applied in sequence so explicit `ports` entries win.

#### 2. Update `aigon profile show` display (~line 3230)

When `basePort` is configured, show it in the output:
```
Ports: cc=3801, gg=3802, cx=3803, cu=3804 (basePort: 3800)
```

### Example `.aigon/config.json`

Minimal (just basePort):
```json
{
  "profile": "web",
  "arena": {
    "basePort": 3800
  }
}
```

With one explicit override:
```json
{
  "profile": "web",
  "arena": {
    "basePort": 3800,
    "ports": {
      "cx": 3900
    }
  }
}
```
Result: cc=3801, gg=3802, cx=3900 (explicit), cu=3804.

## Dependencies
- None — self-contained change within `aigon-cli.js`

## Out of Scope
- Auto-detecting port conflicts across projects
- Dynamically assigning ports based on what's available
- Changing the default port ranges for existing profiles (web=3001-3004, api=8001-8004 stay the same)
- Adding `basePort` to the profile presets themselves

## Open Questions
- None

## Related
- Real-world usage: `when-swell` project at `~/src/when-swell/.aigon/config.json` currently uses explicit `arena.ports` as a workaround
- Port fallback chain in `aigon-cli.js` lines 1910, 1947, 1961
