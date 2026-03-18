---
status: submitted
updated: 2026-03-17T04:59:18.154Z
startedAt: 2026-03-17T04:14:42.080Z
completedAt: 2026-03-17T04:59:18.154Z
events:
  - { ts: "2026-03-17T04:14:42.080Z", status: implementing }
  - { ts: "2026-03-17T04:14:57.381Z", status: implementing }
  - { ts: "2026-03-17T04:23:24.497Z", status: waiting }
  - { ts: "2026-03-17T04:58:14.179Z", status: submitted }
---

# Implementation Log: Feature 78 - dashboard-card-agent-sections
Agent: cc

## Summary

Redesigned kanban cards and monitor view to give each agent its own visual section with colored borders, plain-text status, and a single primary action button.

## Key Decisions

- **CSS-only agent colors**: Used `border-left-color` CSS classes (`.agent-cc`, `.agent-gg`, etc.) shared between pipeline cards and monitor rows, each extended with `border-left` where needed.
- **Label remapping in frontend only**: State machine labels ("Focus cc", "View cc") are remapped to clean text ("View", "Start", "Restart") entirely in the template via `AGENT_DISPLAY_NAMES`, `AGENT_ACTION_LABELS`, and a first-word map for the monitor head-action button. The state machine labels were not changed to avoid breaking CLI output.
- **Legacy layout preserved**: Cards without active agents (inbox/backlog/done/research/feedback) keep the existing design unchanged — agent sections only appear for features in `in-progress` or `in-evaluation`.
- **Overflow menu for destructive actions**: `feature-stop` is hidden behind a `⋯` button to prevent accidental clicks. Implemented with a click-toggled CSS class, no framework dependency.
- **`feature-focus` routing fix**: Pre-existing bug discovered — `feature-focus` was calling `/api/action` with `terminal-focus` but the server explicitly rejects terminal-mode actions from that endpoint. Fixed by routing it through `requestFeatureOpen` alongside `feature-open` and `feature-attach`.
- **Removed redundant Attach button**: Monitor view had both a card-level "View/Focus" button and a per-row "Attach" button doing the same thing. Removed "Attach" from rows — the card-level button covers all cases.
- **Monitor view extended in-scope**: User requested monitor view get the same treatment after seeing the pipeline improvements. Full names, icon+text status, colored borders, and clean action labels applied to all three card types (features, research, feedback).

## Issues Encountered

- `AGENT_ACTION_LABELS` remapping in `buildNextActionHtml` initially failed because it relied on an `action` field not yet in the server's `nextActions` payload (server restart required for utils.js changes). Solved by switching to a first-word-based map that works purely from the label string, requiring no server restart.
