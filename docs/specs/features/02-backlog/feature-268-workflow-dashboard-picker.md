# Feature: workflow-dashboard-picker

## Summary
Add a workflow dropdown to the dashboard Autonomous Start modal. Selecting a saved workflow pre-fills the agent checkboxes, eval/review dropdowns, and stop-after selector. Users can override individual settings before submitting, and optionally save the current configuration as a new workflow via a "Save as workflow" button.

## User Stories
- [ ] As a user starting an autonomous feature from the dashboard, I can select a saved workflow from a dropdown to pre-fill all settings
- [ ] As a user who tweaked a workflow's settings, I can save the modified configuration as a new workflow directly from the modal

## Acceptance Criteria
- [ ] Workflow dropdown appears at the top of the Autonomous Start modal
- [ ] Selecting a workflow populates agent checkboxes, eval/review dropdowns, and stop-after from the definition
- [ ] User can override any pre-filled value before submitting
- [ ] "Save as workflow" button saves the current modal state as a new workflow definition
- [ ] New API endpoint `GET /api/playbooks?repoPath=...` (or `/api/workflows`) returns merged workflow list
- [ ] Built-in, global, and project workflows all appear with provenance labels

## Validation
```bash
node -c aigon-cli.js
MOCK_DELAY=fast npm run test:ui
```

## Technical Approach
- Add one dropdown to the existing Autonomous Start modal — no new page or modal
- New API endpoint returns merged (built-in + global + project) workflow list
- Frontend populates form fields on workflow selection, then submits as normal
- Follows the Docker Compose profiles pattern: add one dropdown to an existing UI

## Dependencies
- depends_on: workflow-definitions

## Out of Scope
- Workflow CRUD from the dashboard (manage via CLI)
- Multi-stage pipeline visualization
- Workflow editing UI

## Open Questions
- None

## Related
- Research: #29 workflow-templates
