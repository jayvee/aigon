# Feature: Create feature from dashboard

## Summary
Add a "New Feature" button to the dashboard that creates a feature spec file in `01-inbox/` and opens a coding agent session to flesh out the spec. Today, creating a feature requires switching to the terminal and running `aigon feature-create`. This brings that workflow into the dashboard so the user never has to leave it.

## User Stories
- [ ] As a user with a feature idea, I want to click a button on the dashboard to start creating a new feature, so I stay in my flow without switching to a terminal
- [ ] As a user, I want the new feature to appear on the board immediately after creation, so I can see it in the inbox and continue the workflow from there

## Acceptance Criteria
- [ ] A "+ New Feature" button is visible in the Pipeline view header (inbox column) and/or in the top nav area
- [ ] Clicking it shows a minimal modal asking only for the feature name (single text input + Create button)
- [ ] On submit, the dashboard calls `POST /api/action` with `feature-create` and the provided name
- [ ] The spec file is created in `docs/specs/features/01-inbox/feature-{slug}.md` with the standard template
- [ ] After creation, the dashboard auto-refreshes and the new feature card appears in the Inbox column
- [ ] After creation, an agent session is opened in the terminal (via the existing `runAskAgent` / session API) so the user can refine the spec with AI assistance
- [ ] If the user cancels the modal, nothing happens
- [ ] Feature name is validated: non-empty, reasonable length, no special characters that break filenames

## Validation
```bash
node --check lib/dashboard-server.js
node --check lib/commands/feature.js
```

## Technical Approach

### Option Analysis

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| A. Name-only modal + agent session | Modal collects just a name, creates the file, then opens an agent session in the repo root to flesh out the spec | Simple UI, leverages existing `runAskAgent` infra, agent can read/write the spec interactively | Two-step (create then refine) |
| B. Full spec editor in dashboard | Rich form/editor for all spec fields inline | All-in-one | Heavy UI work, duplicates what the agent does better |
| C. Just create the file | Modal collects name, creates spec, done | Simplest | User still needs to manually open spec for editing |

**Recommended: Option A** — This matches the user's actual workflow ("I always use the coding agent to create a feature"). The dashboard just handles the naming/creation step, then immediately hands off to an agent session that can help write the spec interactively.

### Implementation

**Frontend (`templates/dashboard/js/pipeline.js` or new `create.js`)**:
1. Add a `+ New Feature` button in the inbox column header (Pipeline view) and optionally in the top nav
2. On click, show a small modal with a single text input for the feature name
3. On submit: call `requestAction('feature-create', [name], repoPath)`
4. On success: trigger a refresh, then call `runAskAgent(repoPath, getAskAgent())` to open an agent session
5. The agent session opens in the repo root (not a worktree) — the agent can then edit the spec file

**Backend (`lib/commands/feature.js` — `feature-create`)**:
- Already exists and works — no changes needed. The `POST /api/action` -> `feature-create` path already works via the dashboard server's generic action dispatcher.

**Modal HTML (`templates/dashboard/index.html`)**:
- Add a modal similar to the existing close-modal and agent-picker patterns
- Single input field, Create button, Cancel button

### Agent Session Handoff
After creating the feature file, the dashboard opens an agent session via the existing `/api/session/ask` endpoint (same as the "Ask agent" button in the sidebar). The agent will be in the repo root and can immediately edit the newly created spec file. The user can describe what they want and the agent fills in the spec template.

## Dependencies
- Existing `feature-create` command (already works via `POST /api/action`)
- Existing `runAskAgent` / `/api/session/ask` infrastructure (already in `sidebar.js`)
- Existing modal patterns (agent-picker, close-modal) for consistency

## Out of Scope
- Inline spec editing within the dashboard (too complex, agent does this better)
- Creating research topics or feedback items from dashboard (future features)
- Pre-populating the spec with AI-generated content before opening the agent

## Open Questions
- Should the agent session receive a hint about which spec file to edit? Could pass a message like "Edit the spec at docs/specs/features/01-inbox/feature-{slug}.md" — but this depends on session API capabilities

## Related
- `lib/commands/feature.js` — `feature-create` handler
- `templates/dashboard/js/sidebar.js` — `runAskAgent()`, `/api/session/ask`
- `templates/dashboard/js/actions.js` — `requestAction()` pattern
- `templates/dashboard/index.html` — modal patterns (agent-picker, close-modal)
