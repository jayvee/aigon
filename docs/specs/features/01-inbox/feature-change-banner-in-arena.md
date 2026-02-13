# Feature: Visual Context Indicators for Arena Mode

## Summary

During arena mode (multiple agents competing on the same feature), it's not obvious which agent/worktree you're working with. This feature adds visual context indicators in two separate locations:
1. **Browser/Running Application** - Dev server banner displayed in the browser showing agent, port, and feature ID
2. **Terminal** - Terminal header and color scheme in Warp showing feature ID and agent when auto-running

## User Stories

### Part 1: Browser/Running Application Visual Indicators

- [ ] As a developer running arena mode, I want to see **in the browser** (in the running application) which agent, port, and feature ID the dev server is running for, so I can easily identify which implementation I'm testing
- [ ] As a developer comparing arena implementations side-by-side in multiple browser tabs, I want visual indicators **in each browser tab** (within the running app) to distinguish between agents

### Part 2: Terminal Visual Indicators

- [ ] As a developer opening a worktree in Warp terminal, I want the **terminal header/title** to show the feature ID and agent name so I know what context I'm working in
- [ ] As a developer switching between multiple arena worktrees in different terminal tabs/windows, I want **terminal color schemes** to help distinguish which feature/agent I'm working on

## Acceptance Criteria

### Part 1: Browser/Running Application Visual Indicators

**Location:** Displayed within the running application (browser for web apps)

- [ ] **In the browser/running app**, a dev server banner displays:
  - Agent name (e.g., "Claude", "Gemini", "Codex", "Cursor")
  - Port number (e.g., "3001", "3002", "3003", "3004")
  - Feature ID (e.g., "#08", "#55")
- [ ] Banner color **in the browser** is unique per agent (distinct colors for each agent)
- [ ] Works in arena mode (multiple worktrees with different agents, each showing its own banner **in the browser**)
- [ ] Configuration is agent-specific (each worktree's running app shows its own context **in the browser**)
- [ ] Works with existing dev server setup (web/api profiles)
- [ ] Framework-dependent implementation (depends on whether building web app, API, etc. - the app itself must render the banner)

### Part 2: Terminal Visual Indicators

**Location:** Displayed in the terminal (Warp terminal header and color scheme)

- [ ] **In the terminal**, the header/title displays feature ID and agent when auto-running agent CLI
- [ ] **Terminal color scheme** indicates feature/agent context (visible in terminal background/text colors)
- [ ] Works with `worktree-open` command (Warp terminal)
- [ ] Applies to both solo worktree and arena modes
- [ ] Controlled entirely by Aigon (via worktree-open launch configs - no app code needed)

## Technical Approach

### Part 1: Browser/Running Application Visual Indicators

**Location:** Rendered within the running application (visible in browser for web apps)

**Agent-Specific Banner Configuration:**

Each agent worktree should have agent-specific banner configuration that appears **in the browser/running app**:

- **cc** (Claude): Blue banner **in browser**, "Claude" name
- **gg** (Gemini): Green banner **in browser**, "Gemini" name  
- **cx** (Codex): Purple banner **in browser**, "Codex" name
- **cu** (Cursor): Orange banner **in browser**, "Cursor" name

**Implementation Options:**

1. **Environment variable approach**: Set `AGENT_NAME`, `BANNER_COLOR`, `FEATURE_ID`, and `PORT` in `.env.local` during `feature-setup`
2. **Framework-specific**: Application code reads env vars and renders banner component **in the browser**
3. **Port-based detection**: Application uses PORT to determine agent (cc=3001, gg=3002, etc.) and displays **in browser**

**Integration Point:**

- Aigon: Modify `feature-setup` command to add agent-specific banner config to `.env.local`
- Application: Framework-specific code reads env vars and displays banner **in the browser/running app**
- Note: Implementation depends on application framework (Next.js, React, etc.) - the app itself must render the banner **in the browser**

**Example Banner Display (in browser):**
```
┌─────────────────────────────────────┐
│ Claude | Port 3001 | Feature #08   │  ← Displayed IN THE BROWSER
└─────────────────────────────────────┘
```

### Part 2: Terminal Visual Indicators

**Location:** Displayed in the terminal (Warp terminal header and color scheme)

**Warp Terminal Integration:**

- Modify `worktree-open` command to set **terminal** header/title in Warp launch config
- Use Warp's launch configuration YAML to set:
  - **Terminal window/tab title**: `Feature #08 - Claude` (visible in terminal tab/window)
  - **Terminal color scheme**: Agent-specific colors (visible in terminal background/text)
  - Or use Warp's session metadata

**Implementation:**

1. **Terminal Title/Header**: Set via Warp launch config `name` or `title` field (appears in **terminal tab/window**)
2. **Terminal Color Scheme**: Use Warp's color scheme configuration or terminal profile (affects **terminal colors**)
3. **Session Metadata**: Use Warp's session variables if available

**Example Terminal Display:**
```
Terminal Tab Title: "Feature #08 - Claude (agent) | Port 3001"  ← IN TERMINAL
Terminal Colors: Blue theme for Claude                           ← IN TERMINAL
```

**Integration Point:**

- Modify `buildAgentCommand()` or `worktree-open` command
- Update Warp launch configuration YAML generation
- Set terminal title/color when creating launch config

## Dependencies

### Part 1: Browser/Running Application
- Existing dev server setup (web/api profiles)
- `.env.local` creation in `feature-setup`
- Agent detection from worktree name or PORT
- Application framework support (Next.js, React, etc.) - **app must render banner in browser**
- Application code changes to read env vars and display banner **in the browser**

### Part 2: Terminal
- Warp terminal launch configuration system
- `worktree-open` command implementation
- Terminal color scheme support
- **No application code changes needed** - entirely controlled by Aigon via terminal config

## Out of Scope

- Changing browser banner for solo mode (not needed - only one agent)
- Custom browser banner styling beyond color/name/port/feature
- Browser banner configuration UI
- Terminal visual indicators for solo mode (may be useful but lower priority)
- Support for terminals other than Warp (future enhancement)
- Terminal color schemes for non-Warp terminals
- Visual indicators in non-browser applications (APIs, CLI tools, etc.) - Part 1 is browser-specific

## Related

- `feature-setup` - Creates worktrees and `.env.local` files
- `worktree-open` - Opens worktrees in Warp terminal
- Arena mode workflow - Multiple agents competing
- Port configuration - Each agent has unique PORT
- Warp launch configurations - Used for terminal setup

