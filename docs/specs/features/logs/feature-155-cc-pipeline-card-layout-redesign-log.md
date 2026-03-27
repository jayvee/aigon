# Implementation Log: Feature 155 - pipeline-card-layout-redesign
Agent: cc

## Plan

Implement Option D (Hybrid) from the spec: 2-char short agent names + stacked status on its own row. This gives the best space efficiency while keeping everything readable and the globe always visible.

## Progress

- Analyzed current layout: agent name, status, and globe all on one flex row — long names cause status truncation and globe disappearance
- Added `AGENT_SHORT_NAMES` mapping in actions.js (CC, GG, CX, CU, MV, Drive)
- Refactored `buildAgentStatusHtml()` to return a data object `{ icon, label, cls, devServerUrl }` instead of an HTML string
- Added `buildAgentStatusSpan()` wrapper for backward compatibility with monitor view Alpine templates
- Restructured `buildAgentSectionHtml()`: Row 1 = short name + globe (flex), Row 2 = status (full width, never truncated)
- Updated solo drive and eval session sections to use same two-row layout
- Shortened flag button labels: "Mark Submitted" → "Submit", "Re-open Agent" → "Re-open", "View Work" → "View"
- Added `.kcard-flag-btn` compact CSS and `.status-flagged` color (orange, was previously unstyled)
- Updated monitor view templates to use `buildAgentStatusSpan` (no visual change to monitor)
- Verified with Playwright screenshots: pipeline and monitor views both render correctly

## Decisions

- **Option D chosen** over A/B/C: best balance of space efficiency (short IDs) and readability (status on own row). Option A (abbreviate only) still crams status on same line. Option B (full names stacked) wastes space. Option C (single line per agent) loses individual agent actions.
- **Short names always used** (not just when space is tight) — consistency is better than conditional abbreviation. Full name available via tooltip on hover.
- **Agent name font bumped to 11px/700** — with only 2 chars, it can be slightly larger and bolder for quick scanning.
- **Globe moved to right of agent name row** via `margin-left: auto` — always visible since it no longer competes with status text.
- **Flag buttons compacted** with smaller font/padding + shorter labels — 3 agents with flag state no longer overwhelm the card.

## Files Changed

- `templates/dashboard/js/actions.js` — added AGENT_SHORT_NAMES mapping
- `templates/dashboard/js/pipeline.js` — refactored buildAgentStatusHtml, added buildAgentStatusSpan, restructured agent sections
- `templates/dashboard/styles.css` — new .kcard-agent-status-row, updated header/name/status/dev-slot styles, added flag-btn and status-flagged
- `templates/dashboard/index.html` — updated monitor view to use buildAgentStatusSpan
