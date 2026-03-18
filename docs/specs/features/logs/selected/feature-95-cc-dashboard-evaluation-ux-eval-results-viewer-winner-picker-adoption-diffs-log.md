---
status: submitted
updated: 2026-03-18T10:32:33.236Z
startedAt: 2026-03-18T10:01:01.661Z
completedAt: 2026-03-18T10:32:33.236Z
events:
  - { ts: "2026-03-18T10:01:01.661Z", status: implementing }
  - { ts: "2026-03-18T10:02:50.754Z", status: implementing }
  - { ts: "2026-03-18T10:06:46.607Z", status: submitted }
---

# Implementation Log: Feature 95 - dashboard-evaluation-ux-eval-results-viewer-winner-picker-adoption-diffs
Agent: cc

## Plan

Four-part implementation:
1. Server: extract `winnerAgent` and `evalPath` alongside `evalStatus` in `collectDashboardStatusData`
2. Agent picker: add `preselect` option to `showAgentPicker` to pre-check the recommended winner
3. Cards: show winner badge + View Eval button on eval cards; wire eval button to spec drawer
4. Actions: feature-close button and drag-to-done both show winner picker before dispatching

## Progress

All acceptance criteria implemented in a single commit (ecb4214).

## Decisions

- **winnerAgent extraction**: parse first token before space/paren from the winner line (`"cc (Claude)"` → `"cc"`). This is safe for all known agent ID formats.
- **evalPath**: set to the full absolute path of the eval file when it exists; null otherwise. The spec drawer's `/api/spec` endpoint already handles absolute paths.
- **View Eval button placement**: rendered immediately after the `kcard-status` div (both agent-section and legacy layouts) so it's visible without scrolling the card.
- **feature-close special-casing**: added a dedicated `case 'feature-close'` in `handleValidAction` rather than modifying the `default` branch, keeping the non-eval path unchanged.
- **drag winnerAgent propagation**: added `winnerAgent` to `dragState` at dragstart so the onDrop handler can pass it as `preselect` without needing to look up the feature object.
- **CSS**: `.kcard-winner` uses the same green (`#86efac`) as `.eval-badge.pick-winner` for visual consistency. `.kcard-eval-btn` is full-width for easy tap target.
