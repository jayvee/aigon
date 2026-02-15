# Feature: research-open-arena

## Summary

Enable opening multiple terminal windows side-by-side for parallel research in arena mode. Similar to `worktree-open --all` for features, this command opens all selected research agents in split panes, each pre-loaded with the agent CLI ready to run `research-conduct`. Unlike feature arena mode which uses separate worktrees, research arena uses findings files in the main repository, so all panes open in the same directory with different agent commands.

## User Stories

- [ ] As a user, I want to quickly open all research arena agents side-by-side so I can run parallel research without manually opening multiple terminals
- [ ] As a user, I want each terminal pane to be pre-loaded with the correct agent CLI and research-conduct command so I don't have to type it manually
- [ ] As a user, I want the command to auto-detect which agents are set up for arena research by finding findings files
- [ ] As a user, I want the command to work with my preferred terminal (Warp, VS Code, Cursor) just like worktree-open does
- [ ] As a user, I want clear error messages if arena mode isn't set up or if findings files are missing

## Acceptance Criteria

- [ ] `research-open <ID>` command created (or `research-open <ID> --all` if extending existing command)
- [ ] Command detects arena mode by scanning for findings files: `docs/specs/research-topics/logs/research-{ID}-*-findings.md`
- [ ] Command extracts agent IDs from findings filenames (e.g., `research-05-cc-findings.md` → agent `cc`)
- [ ] Command builds agent CLI commands for `research-conduct` using each agent's `CMD_PREFIX` placeholder (e.g., `/aigon:research-conduct` for Claude/Gemini, `/aigon-research-conduct` for Cursor)
- [ ] Command opens multiple panes side-by-side in Warp terminal (horizontal split, like arena feature mode)
- [ ] All panes use the main repository directory (not separate worktrees)
- [ ] Each pane runs the appropriate agent CLI with the correct command prefix (e.g., `/aigon:research-conduct {ID}` for Claude/Gemini, `/aigon-research-conduct {ID}` for Cursor, `/prompts:aigon-research-conduct {ID}` for Codex)
- [ ] Command respects terminal preference from global config (`~/.aigon/config.json`) or `--terminal` flag
- [ ] Command provides helpful output showing which agents are being opened
- [ ] Command shows clear error if no findings files found (not in arena mode)
- [ ] Command shows clear error if research ID doesn't exist or isn't in progress
- [ ] For non-Warp terminals, command prints manual setup instructions with paths and commands

## Technical Approach

### Command Design

**Option A: New command `research-open`**
- `research-open <ID>` - Opens all arena agents side-by-side
- Simple, clear naming that mirrors `worktree-open`
- Requires new command implementation

**Option B: Extend existing pattern**
- Could add `--all` flag to a research command, but there's no existing "research-open" command
- Prefer Option A for clarity

**Decision: Use Option A - new `research-open <ID>` command**

### Mode Detection

Similar to how `research-conduct` and `research-done` detect arena mode:

```javascript
// Find findings files for this research ID
const logsDir = path.join(PATHS.research.root, 'logs');
const findingsFiles = fs.readdirSync(logsDir)
    .filter(f => f.startsWith(`research-${paddedId}-`) && f.endsWith('-findings.md'));

// Extract agent IDs from filenames
const agents = findingsFiles.map(file => {
    const match = file.match(/^research-\d+-(\w+)-findings\.md$/);
    return match ? match[1] : null;
}).filter(Boolean);
```

### Agent Command Building

Create a new helper function `buildResearchAgentCommand(agentId, researchId)` similar to `buildAgentCommand(wt)`:

```javascript
function buildResearchAgentCommand(agentId, researchId) {
    const cliConfig = getAgentCliConfig(agentId);
    const agentConfig = loadAgentConfig(agentId);
    
    // Research commands use the agent's CMD_PREFIX placeholder
    // e.g., "/aigon:research-conduct" for Claude/Gemini, "/aigon-research-conduct" for Cursor
    const cmdPrefix = agentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
    const prompt = `${cmdPrefix}research-conduct ${researchId}`;
    
    // Use the same flag pattern as feature-implement (e.g., --permission-mode acceptEdits)
    if (cliConfig.implementFlag) {
        return `${cliConfig.command} ${cliConfig.implementFlag} "${prompt}"`;
    }
    return `${cliConfig.command} "${prompt}"`;
}
```

**Note:** Research commands use the agent's `CMD_PREFIX` placeholder (from agent config) rather than a separate `conductPrompt`. This matches how research-conduct is documented in templates.

### Warp Launch Configuration

Reuse `openInWarpSplitPanes()` helper but adapt for research:

```javascript
// Create config objects similar to worktree configs
const researchConfigs = agents.map(agentId => ({
    agent: agentId,
    researchId: paddedId,
    path: process.cwd(), // Main repo directory, not worktree
    agentCommand: buildResearchAgentCommand(agentId, paddedId)
}));

const configName = `arena-research-${paddedId}`;
const title = `Arena Research: ${researchNum} - ${researchName}`;
openInWarpSplitPanes(researchConfigs, configName, title);
```

**Key difference:** All panes use `process.cwd()` (main repo) instead of separate worktree paths.

### Terminal Support

- **Warp**: Use split panes (horizontal layout) - same as feature arena mode
- **VS Code / Cursor**: Print manual setup instructions with paths and commands (same pattern as `worktree-open`)

### Error Handling

1. **No findings files found (solo mode or not set up):**
   ```
   ❌ Research 04 is not in arena mode.
   
   To start arena research:
     aigon research-setup 04 cc gg cx
   
   For solo research, open a terminal manually and run:
     /aigon:research-conduct 04
   ```

2. **Research not found or not in progress:**
   ```
   ❌ Could not find research "04" in progress.
   
   Run 'aigon research-setup 04 [agents...]' first.
   ```

3. **No agents detected (edge case - findings files exist but can't parse agents):**
   ```
   ❌ Could not detect agents from findings files for research 04.
   
   Found files in docs/specs/research-topics/logs/ but couldn't extract agent IDs.
   Ensure findings files follow the pattern: research-04-{agent}-findings.md
   ```

4. **Agent config missing:**
   ```
   ❌ Agent "cx" is not configured.
   
   Install agent config with: aigon install-agent cx
   ```

### Integration with Existing Commands

After `research-setup` creates findings files, it currently shows a table like:

```
Research 04 is set up in arena mode with 4 agents:
  ┌──────────────────┬─────────────────────────────────┐
  │      Agent       │          Findings file          │
  ├──────────────────┼─────────────────────────────────┤
  │ cc (Claude Code) │ logs/research-04-cc-findings.md │
  ├──────────────────┼─────────────────────────────────┤
  │ cu (Cursor)      │ logs/research-04-cu-findings.md │
  ├──────────────────┼─────────────────────────────────┤
  │ cx (Codex)       │ logs/research-04-cx-findings.md │
  ├──────────────────┼─────────────────────────────────┤
  │ gg (Gemini)      │ logs/research-04-gg-findings.md │
  └──────────────────┴─────────────────────────────────┘
  Topic moved to 03-in-progress/. Each agent should run /aigon:research-conduct 04 and write to their own findings file.

  /aigon:research-conduct 04
```

**Update `research-setup` output to include the new command as Option 1:**

```javascript
// In research-setup command, after the table:
console.log(`\n💡 Next steps:`);
console.log(`   Option 1: Open all agents side-by-side:`);
console.log(`     aigon research-open ${researchNum}`);
console.log(`\n   Option 2: Run each agent individually:`);
console.log(`     [Open each agent terminal] ${agentConfig.placeholders.CMD_PREFIX}research-conduct ${researchNum}`);
console.log(`\n   When done: aigon research-done ${researchNum}`);
```

This makes `research-open` the recommended first option for arena mode, similar to how `worktree-open --all` is suggested for feature arena mode.

### Command Usage Examples

```bash
# Open all arena agents side-by-side for research 04
aigon research-open 04

# Override terminal preference
aigon research-open 04 --terminal=code

# Short form (pads to 2 digits automatically)
aigon research-open 4
```

**Expected output:**
```
🚀 Opening 4 agents side-by-side in Warp:
   Research: 04 - topic-name

   cc       → /path/to/main/repo
   cu       → /path/to/main/repo
   cx       → /path/to/main/repo
   gg       → /path/to/main/repo

   Warp config: ~/.warp/launch_configurations/arena-research-04.yaml
```

### Warp YAML Structure

```yaml
---
name: arena-research-05
windows:
  - tabs:
      - title: "Arena Research: 05 - topic-name"
        layout:
          split_direction: horizontal
          panes:
            - cwd: "/path/to/main/repo"
              commands:
                - exec: claude --permission-mode acceptEdits "/aigon:research-conduct 05"
            - cwd: "/path/to/main/repo"
              commands:
                - exec: gemini --yolo "/aigon:research-conduct 05"
            - cwd: "/path/to/main/repo"
              commands:
                - exec: codex [flags] "/prompts:aigon-research-conduct 05"
```

**Note:** Each agent uses its own CLI flags (`implementFlag` from config) and command prefix (`CMD_PREFIX` from placeholders).

## Dependencies

- Existing `research-setup` command (creates findings files)
- Existing `openInWarpSplitPanes()` helper function
- Agent CLI configuration system (`getAgentCliConfig()`)
- Research findings file detection logic (already exists in `research-conduct` and `research-done`)
- Terminal preference system (`loadGlobalConfig()`)

## Out of Scope

- Opening individual agent terminals (use existing manual process or future enhancement)
- Support for solo mode research (not needed - solo mode doesn't need multiple terminals)
- Automatic orchestration/execution of research (agents still run manually)
- Support for other terminal types beyond Warp/VS Code/Cursor (can add later)
- Tab management or window positioning (Warp handles this)

## Open Questions

- ~~Should we add `conductPrompt` and `conductFlag` to agent configs, or reuse `implementPrompt`/`implementFlag`?~~
  - **Resolved:** Research commands use the agent's `CMD_PREFIX` placeholder (e.g., `/aigon:research-conduct`) and reuse `implementFlag` for CLI flags. No new config fields needed.
- Should the command work in solo mode (just open one terminal)?
  - **Proposal:** No - solo mode doesn't need this. Users can open terminal manually.
- Should we support opening a subset of agents (e.g., `research-open 05 cc gg`)?
  - **Proposal:** Start with all agents only. Can add filtering later if needed.
- What should happen if findings files exist but agents aren't installed/configured?
  - **Proposal:** Show error listing which agents are missing configs

## Related

- Feature: `feature-worktree-open-terminal` - Similar functionality for feature arena mode
- Feature: `feature-03-arena-research` - Research arena mode implementation
- Feature: `feature-parallel-features` - Parallel mode for features (different use case)
- Research: None currently
