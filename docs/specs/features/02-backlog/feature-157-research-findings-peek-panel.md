# Feature: research findings peek panel

## Summary

Add a "View" button to research agent rows on the dashboard (Pipeline and Monitor views) that opens the Peek panel with the agent's findings file. This lets users read research findings inline before running an evaluation, without navigating to the file system. Mirrors the existing "View Work" pattern on feature cards but for research findings.

## User Stories

- [ ] As a user with submitted research, I want to click "View" on a research agent row to read their findings in the Peek panel, so I can review quality before evaluating
- [ ] As a user comparing multiple agents' research, I want to quickly switch between findings by clicking "View" on each agent row

## Acceptance Criteria

- [ ] Research agent rows show a "View" button when the agent status is `submitted` or `session-ended`
- [ ] Clicking "View" opens the Peek panel with the agent's findings file (`docs/specs/research-topics/logs/research-{ID}-{agent}-findings.md`)
- [ ] The Peek panel renders the markdown findings with proper formatting
- [ ] Works on both Pipeline and Monitor views
- [ ] Button does not appear for agents that haven't submitted (no findings file yet)
- [ ] If the findings file doesn't exist, show a message in the Peek panel ("No findings file found")

## Validation

```bash
node -c templates/dashboard/js/pipeline.js
node -c templates/dashboard/js/monitor.js
```

## Technical Approach

### Backend
- Add an API endpoint or extend existing ones to serve research findings content
- Could use the existing `/api/file` pattern or add `GET /api/repos/:token/research/:id/agents/:agent/findings`
- The findings file path is deterministic: `docs/specs/research-topics/logs/research-{ID}-{agent}-findings.md`

### Frontend
- The Peek panel (`js/peek.js`) already exists and supports rendering content — reuse `openPeekPanel()`
- Add a "View" button to research agent rows in both `pipeline.js` (research card rendering) and `monitor.js`
- Button calls a function that fetches the findings content and opens it in the Peek panel
- Follow the same pattern as feature "View Work" buttons

### Key files
- `templates/dashboard/js/pipeline.js` — research card agent row rendering
- `templates/dashboard/js/monitor.js` — monitor view research rendering
- `templates/dashboard/js/peek.js` — Peek panel (existing)
- `lib/dashboard-server.js` — API endpoint for findings content

## Dependencies

- Peek panel must be functional (already is)

## Out of Scope

- Editing findings from the dashboard
- Side-by-side comparison view of multiple agents' findings
- Research findings slash command (separate feature)
- Feature implementation "View Work" changes

## Related

- Existing Peek panel: `templates/dashboard/js/peek.js`
- Research findings template: `templates/specs/research-findings-template.md`
- Feature "View Work" button pattern in `pipeline.js`
