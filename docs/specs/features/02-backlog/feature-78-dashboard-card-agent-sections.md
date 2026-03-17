# Feature: dashboard-card-agent-sections

## Summary

Redesign pipeline Kanban cards so each agent gets its own visually distinct section within the card. Currently, agent badges ("cc"), status dots, and action buttons ("Focus cc", "Stop cc") are all mixed together at the same visual level, making it hard to tell what's status and what's an action. The new design separates agent sections with coloured borders, shows status as plain text, promotes one primary action per agent, and tucks destructive/secondary actions into an overflow menu.

## User Stories

- [ ] As a user, I can glance at a card and immediately tell which agents are working on it and what state each is in
- [ ] As a user, I can distinguish agent-level actions (Focus, Stop) from card-level transitions (Evaluate, Close)
- [ ] As a user, I see full agent names ("Claude Code", "Gemini") not cryptic codes ("cc", "gg")
- [ ] As a user, destructive actions (Stop) don't compete visually with the main action (Focus)
- [ ] As a user, Fleet cards with 2-3 agents are scannable, not a wall of same-looking buttons

## Acceptance Criteria

### Agent Sections
- [ ] Each agent on a card renders as its own visual section (bordered box or tinted region)
- [ ] Each agent section has a coloured left border or accent identifying the agent (e.g., blue=Claude, purple=Gemini, green=Codex, orange=Cursor)
- [ ] Agent section header shows full agent name, not abbreviation (map: cc=Claude Code, gg=Gemini, cx=Codex, cu=Cursor)
- [ ] Agent status is shown as plain text with a status icon, not as a clickable badge. Status maps directly from state machine context:
  - `implementing` + tmux running → `● Running` (green dot) — agent is actively working
  - `implementing` + tmux dead → `○ Session ended` (hollow dot) — agent was working but session crashed/exited
  - `waiting` → `⏳ Needs input` (hourglass) — agent is waiting for user interaction
  - `submitted` → `✓ Submitted` (checkmark) — agent has finished its work
  - `idle`/`error`/undefined → `○ Not started` (hollow dot) — agent hasn't begun

### Action Hierarchy
- [ ] Each agent section has at most ONE primary action button (the most useful next step). Labels come from the state machine but are renamed for clarity:
  - `implementing` + tmux running → **"View"** (attaches to the live tmux session)
  - `implementing` + tmux dead → **"Restart"** (re-opens the agent session)
  - `waiting` → **"View"** with high priority styling (agent needs you NOW)
  - `idle`/not started → **"Start"** (opens worktree and launches agent)
  - `submitted` → **"View"** (review the finished work)
  - Submitted → "Focus" (view the completed work)
- [ ] Secondary/destructive actions are behind an overflow menu (`⋯` or `▾`):
  - **"End Session"** (was "Stop") — kills the tmux session. Label clarifies this ends the agent, not pauses it.
- [ ] Card-level actions render BELOW all agent sections, visually separated. These only appear when the state machine says they're valid:
  - Solo + all submitted → **"Accept & Close"** (primary) + **"Run Review"** (secondary)
  - Fleet + all submitted → **"Run Evaluation"** (primary)
  - No card-level actions while agents are still working (the state machine enforces this via guards)

### Visual Design
- [ ] Agent sections stack vertically within the card
- [ ] Card header (ID + title) remains at the top, unchanged
- [ ] Solo cards (one agent) still show the agent section — consistent layout regardless of agent count
- [ ] Cards with no agents (inbox, backlog) render as they do today — no agent sections

### Data
- [ ] Agent display names come from agent config (`templates/agents/<id>.json`) or a hardcoded map — not the slug
- [ ] Agent status comes from the state machine / dashboard status data (tmux session alive, submitted flag, etc.)

### Quality
- [ ] `node -c aigon-cli.js` exits 0
- [ ] `npm test` passes
- [ ] Dashboard loads and renders correctly in browser (verify with screenshot)

## Validation

```bash
node -c aigon-cli.js && npm test
```

## Technical Approach

### Card Layout (HTML structure)

```html
<div class="kcard">
  <div class="kcard-header">
    <span class="kcard-id">#162</span>
    <span class="kcard-title">production smoke test suite</span>
  </div>

  <!-- One section per agent -->
  <div class="kcard-agent agent-cc">
    <div class="kcard-agent-header">
      <span class="agent-name">Claude Code</span>
      <span class="agent-status status-running">● Running</span>
    </div>
    <div class="kcard-agent-actions">
      <button class="btn btn-primary">Focus</button>
      <button class="btn btn-overflow">⋯</button>
      <!-- overflow menu: Stop, Logs -->
    </div>
  </div>

  <!-- Card-level transitions -->
  <div class="kcard-transitions">
    <button class="btn btn-secondary">Close</button>
  </div>
</div>
```

### CSS — Agent Colours

```css
.agent-cc { border-left: 3px solid #6B9EFF; }  /* Claude — blue */
.agent-gg { border-left: 3px solid #A78BFA; }  /* Gemini — purple */
.agent-cx { border-left: 3px solid #4ADE80; }  /* Codex — green */
.agent-cu { border-left: 3px solid #FB923C; }  /* Cursor — orange */
```

### Agent Name Map

```javascript
const AGENT_DISPLAY_NAMES = {
  cc: 'Claude Code',
  gg: 'Gemini',
  cx: 'Codex',
  cu: 'Cursor'
};
```

### Overflow Menu

Simple CSS-only dropdown that appears on click of `⋯` button. Contains Stop, Logs, and any other secondary actions. No framework dependency needed.

### Changes Required

1. **`templates/dashboard/index.html`** — rewrite `buildKanbanCard()` to render agent sections; rewrite `buildValidActionsHtml()` to split agent-level vs card-level actions; add CSS for agent sections, colours, overflow menu
2. **`lib/utils.js`** or **`lib/state-machine.js`** — ensure agent status (running/stopped/submitted) is included in the data passed to the dashboard template
3. **`lib/dashboard.js`** — no changes expected (data collection already includes agent info)

## Dependencies

- State machine (`lib/state-machine.js`) — already computes `validActions` per agent
- Dashboard status data already includes agent session info (tmux alive check)

## Out of Scope

- Research cards (follow-up if the pattern works for features)
- Feedback cards (different lifecycle, simpler)
- Drag-and-drop changes (works independently of card internals)
- Monitor/Sessions tabs

## Open Questions

- Should the overflow menu show on hover or click? (Click is more intentional, hover risks accidental reveals)
- Should "Close" card-level action require confirmation (modal) for Fleet features where not all agents have submitted?

## Related

- Feature 65: kanban-card-ux-rethink (predecessor — established action hierarchy, but didn't go far enough visually)
- Feature 70: dashboard-infrastructure-rebuild (current dashboard architecture)
