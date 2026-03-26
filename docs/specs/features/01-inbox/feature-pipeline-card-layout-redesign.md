# Feature: Pipeline Card Layout Redesign

## Summary

The pipeline kanban card is cramped and has UX issues. Agent name, status, and dev server globe are all on one line — long agent names like "Claude Code" cause the status to be truncated and the globe to disappear. The card needs a layout redesign to handle all its information gracefully in small real estate.

## Current Card Anatomy

Everything rendered on one card today (`buildKanbanCard` in `pipeline.js`):

### Feature-level
- Feature ID (`#06`) — monospace, tertiary
- Feature name (`search`) — with optional review badge (`● reviewing (cc)`)
- Eval status badge (only in evaluation stage) — status label + eval badge + winner name
- View Eval button (evaluation stage)

### Per-agent section (repeated for each agent)
- **Line 1** (`kcard-agent-header`, single flex row):
  - Agent name (e.g., "Claude Code", "Gemini", "Codex") — `flex-shrink:0`
  - Status indicator + label (e.g., "● Running", "✓ Submitted", "◐ Finished (unconfirmed)") — `text-overflow:ellipsis`
  - Dev server globe link — `width:24px; flex-shrink:0`
- **Line 2** (`kcard-agent-actions`):
  - Primary action button (e.g., "Launch", "Open", "Submit")
  - Overflow menu (⋯) with secondary actions (e.g., "End Session")
  - Flag buttons when session ended: "Mark Submitted", "Re-open Agent", "View Work"

### Card-level actions
- Transition buttons: Close, Evaluate, Review, Start (depends on stage)
- Eval session row (when evaluator is running)

## Problems

1. **Status truncation**: "Claude Code" (11 chars) + "Finished (unconfirmed)" (22 chars) + globe (24px) don't fit in ~180px card width. Status gets ellipsis'd, globe disappears.
2. **Information hierarchy unclear**: Agent name and status compete visually. The status (most important info at a glance) loses.
3. **Globe visibility**: Dev server link is the smallest element and gets squeezed out first — but it's high value (quick preview access).
4. **Action button clutter**: Flag states add 3 buttons per agent. With 2-3 agents, the card becomes mostly buttons.
5. **No visual distinction between agent states**: All agent sections look identical regardless of whether the agent is running, submitted, or ended.

## Design Alternatives

### Option A: Two-row agent header (abbreviate names)
```
┌─────────────────────────┐
│ #06                     │
│ search                  │
│ ┌─────────────────────┐ │
│ │ CC    ● Running   🌐 │ │
│ │ [Launch]          [⋯]│ │
│ ├─────────────────────┤ │
│ │ GG    ✓ Submitted 🌐 │ │
│ └─────────────────────┘ │
│ [Evaluate] [Close]      │
└─────────────────────────┘
```
Keep current layout but abbreviate agent names to 2-char IDs (CC, GG, CX). Saves ~8-10 chars per agent.

### Option B: Stacked agent layout (name above status)
```
┌─────────────────────────┐
│ #06  search             │
│ ┌─────────────────────┐ │
│ │ Claude Code       🌐 │ │
│ │ ● Running            │ │
│ │ [Launch]          [⋯]│ │
│ ├─────────────────────┤ │
│ │ Gemini            🌐 │ │
│ │ ✓ Submitted          │ │
│ └─────────────────────┘ │
│ [Evaluate]              │
└─────────────────────────┘
```
Status moves below agent name. Both get full width. Globe stays anchored right on name row.

### Option C: Compact status strip with color coding
```
┌─────────────────────────┐
│ #06  search             │
│ ┌─────────────────────┐ │
│ │🟢 CC  Running    🌐  │ │
│ │🟢 GG  Submitted  🌐  │ │
│ └─────────────────────┘ │
│ [Launch CC] [Evaluate]  │
│                      [⋯]│
└─────────────────────────┘
```
Flatten agents to one line each, rely on color for status, move all actions to shared action bar at bottom. Most compact.

### Option D: Hybrid — abbreviate + stack status
```
┌─────────────────────────┐
│ #06  search             │
│ ┌─────────────────────┐ │
│ │ CC 🌐               │ │
│ │ ● Running  [Launch] │ │
│ ├─────────────────────┤ │
│ │ GG 🌐               │ │
│ │ ✓ Submitted         │ │
│ └─────────────────────┘ │
│ [Evaluate]              │
└─────────────────────────┘
```
Best of A and B: short IDs, status on own row with room for primary action inline.

## Acceptance Criteria

- [ ] Agent status is never truncated on the card
- [ ] Dev server globe is always visible when a dev server URL exists
- [ ] Cards with 3 agents still look clean and scannable
- [ ] Flag state (session ended, unconfirmed) buttons don't overwhelm the card
- [ ] Agent names are identifiable at a glance
- [ ] Card width works in the existing kanban column layout (~180-220px)
- [ ] Visual verification via Playwright screenshot

## Technical Approach

Files to modify:
- `templates/dashboard/js/pipeline.js` — `buildAgentSectionHtml()`, `buildAgentStatusHtml()`, `buildKanbanCard()`
- `templates/dashboard/styles.css` — `.kcard-agent-header`, `.kcard-agent-status`, `.kcard-dev-slot`, related classes
- No backend changes needed — purely HTML/CSS restructuring

## Out of Scope

- Monitor view cards (separate layout)
- Adding new data to cards (telemetry, cost, etc.)
- Responsive/mobile layout
- Card drag-and-drop changes

## Validation

```bash
node -c templates/dashboard/js/pipeline.js
```

## Open Questions

- Which design option to implement? (User to pick from A/B/C/D above)
- Should agent names always be 2-char abbreviations, or only when space is tight?

## Related

- Research: none
