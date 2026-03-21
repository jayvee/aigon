# Feature 12: Dashboard Remote Monitoring — Implementation Log

## Setup
- Date: 2026-03-19
- Mode: Drive (branch)
- Branch: feature-12-dashboard-remote-monitoring
- Agent: cc (Claude Code)

## Decisions
- Added as a 4th feature card in the existing 2x2 grid (matches the pattern used elsewhere on the page)
- Placed the iPhone screenshot inline within the card rather than as a standalone element — keeps the layout consistent
- Used `max-width: 180px` for the phone screenshot to keep it proportional within the card
- Applied `feature-card--remote` modifier class for targeted styling

## Issues
- `aigon feature-setup 12` CLI had a state tracking bug (reported "done" stage for a backlog item) — worked around by manually creating branch and moving spec
- Smart quotes (curly `"`) were introduced in the HTML during editing, causing the image `src` to break — fixed with `sed` replacing UTF-8 smart quote bytes

## Approach
- Added a "Remote Access" feature card with copy about LAN + Tailscale mobile monitoring
- User provided a real iPhone Safari screenshot (`img/aigon-dashboard-mobile.png`) showing the dashboard with active agent sessions
- Added minimal CSS (`.remote-mobile-screenshot`) to display the phone image centered within the card with border and rounded corners
- Verified with Playwright: image loads correctly (1179x2556), renders at 180px width inside the card
