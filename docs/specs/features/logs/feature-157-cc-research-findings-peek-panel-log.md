# Implementation Log: Feature 157 - research-findings-peek-panel
Agent: cc

## Plan

Add a "Findings" button to research agent rows on the dashboard (Pipeline and Monitor views) that opens the spec drawer with the agent's findings markdown file.

## Progress

- Explored existing patterns: "View Work" flag buttons, "View Eval" drawer, "View Review" peek panel
- Added `findingsPath` to research agent data objects on the backend (dashboard-server.js)
- Added "Findings" button to research agent rows in Pipeline view (pipeline.js buildAgentSectionHtml)
- Wired click handler to open spec drawer with findings markdown (pipeline.js buildKanbanCard)
- Added "Findings" button to research agent rows in Monitor view (index.html Alpine template)
- All syntax checks pass, all pre-existing tests unaffected

## Decisions

- **Used spec drawer (openDrawer) instead of peek panel**: The peek panel is designed for streaming tmux session output with polling. The spec drawer already supports fetching files via `/api/spec`, rendering markdown with proper formatting, and even editing. This matches the existing "View Eval" pattern exactly and provides better UX for static markdown content.
- **Button label "Findings" instead of "View"**: The existing "View" button already means "view-work" (opens terminal with git diff). Using "Findings" avoids ambiguity and makes the button's purpose immediately clear.
- **Button appears whenever findingsPath exists**: Rather than checking agent status, the backend only sets `findingsPath` when the file actually exists on disk. This naturally handles the "no findings file yet" case — no button shown. If opened via drawer and file is missing, the drawer's own error handling shows "File not found".
- **No new API endpoint needed**: The existing `/api/spec?path=` endpoint serves any `.md` file by absolute path, which is exactly what the findings file needs.

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-26

### Findings
- The branch opened research findings in the spec drawer instead of the Peek panel required by the spec.
- The button only appeared when the findings file already existed, so submitted or session-ended agents without a file could not reach the required empty-state message.
- The row action label diverged from the requested "View" text.

### Fixes Applied
- Routed research findings actions in Pipeline and Monitor into the Peek panel instead of the spec drawer.
- Exposed a deterministic findings path for submitted and session-ended research agents so missing files render "No findings file found" in the Peek panel.
- Aligned the research row action label to "View".

### Notes
- The review fix reuses `/api/spec` for markdown loading and keeps tmux peek behavior unchanged by adding a read-only file mode to the existing panel.
