# Feature: Create feature from dashboard

## Summary
Add a "New Feature" button to the dashboard that collects a name and rough description, creates the spec file in `01-inbox/`, and immediately opens a coding agent session seeded with that context. The agent takes the user's rough idea and turns it into a complete spec — acceptance criteria, technical approach, etc. The entire idea-to-spec flow happens without leaving the dashboard.

## User Stories
- [ ] As a user with a feature idea, I want to click a button on the dashboard to start creating a new feature, so I stay in my flow without switching to a terminal
- [ ] As a user, I want the new feature to appear on the board immediately after creation, so I can see it in the inbox and continue the workflow from there

## Acceptance Criteria
- [ ] A "+ New Feature" button is visible in the Pipeline view inbox column header
- [ ] Clicking it shows a modal with two fields: feature name (single line) and description (multiline textarea)
- [ ] Name is validated client-side: non-empty, max 80 chars. Description is optional but encouraged (placeholder guides the user)
- [ ] On submit, the dashboard calls `POST /api/action` with `feature-create` and the provided name
- [ ] The spec file is created in `docs/specs/features/01-inbox/feature-{slug}.md` with the standard template
- [ ] After creation, the dashboard auto-refreshes and the new feature card appears in the Inbox column
- [ ] After creation, an agent session is opened in the terminal, seeded with both the feature name and description so the agent has context to flesh out the full spec
- [ ] If the agent session fails to open (terminal unavailable, agent not configured), the feature is still created — creation and agent handoff are independent
- [ ] If the user cancels the modal, nothing happens
- [ ] Error feedback: if `feature-create` fails (e.g., duplicate name), the modal shows the error message instead of closing

## Validation
```bash
node --check lib/dashboard-server.js
node --check lib/commands/feature.js
```

## Technical Approach

### Option Analysis

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| A. Name + description modal → agent session | Modal collects a name and rough description, creates the file, then opens an agent session seeded with the description | Lightweight UI, agent gets real context to work with, leverages existing infra | Two-step (create then refine) but the handoff is seamless |
| B. Full spec editor in dashboard | Rich form/editor for all spec fields inline | All-in-one | Heavy UI work, duplicates what the agent does better |
| C. Just create the file | Modal collects name, creates spec, done | Simplest | User still needs to manually open spec for editing, no context passed |

**Recommended: Option A** — The dashboard captures just enough context (name + rough idea) to seed the agent effectively. The agent does the heavy lifting: turning a rough description into structured acceptance criteria, technical approach, etc. This matches the actual workflow — the user has a quick idea, types a few sentences, and the agent takes it from there.

### Implementation

**Frontend (`templates/dashboard/js/pipeline.js`)**:
1. Add a `+ New Feature` button in the inbox column header (Pipeline view)
2. On click, show a modal with: feature name (text input), description (textarea, 3–5 rows), Create button, Cancel
3. On submit: call `requestAction('feature-create', [name], repoPath)`
4. On success: trigger a board refresh, then open agent session with the description as initial context
5. On error: show error message in the modal (don't close it), let the user fix and retry

**Backend (`lib/commands/feature.js` — `feature-create`)**:
- Already exists and works — no changes needed. The `POST /api/action` -> `feature-create` path already works via the AIGON server's generic action dispatcher.

**Modal HTML (`templates/dashboard/index.html`)**:
- Add a modal similar to the existing close-modal and agent-picker patterns
- Two fields: name (required), description (optional, multiline)
- Description placeholder: e.g. "What should this feature do? Any technical ideas or constraints?"

### Agent Session Handoff
After creating the feature file, the dashboard opens an agent session via the existing `/api/session/ask` endpoint. The session is seeded with an initial prompt that includes:
- The spec file path (`docs/specs/features/01-inbox/feature-{slug}.md`)
- The user's description from the modal

Example initial prompt passed to the agent:
```
Flesh out the feature spec at docs/specs/features/01-inbox/feature-{slug}.md

The user's idea: "{description}"

Read the spec template, then fill in the acceptance criteria, technical approach, and any other sections based on the description above. Ask clarifying questions if needed.
```

This way the agent starts with real context instead of opening cold. If the `/api/session/ask` endpoint doesn't support an initial message today, that's a small addition to the session API (pass `message` in the POST body).

## Dependencies
- Existing `feature-create` command (already works via `POST /api/action`)
- Existing `runAskAgent` / `/api/session/ask` infrastructure (already in `sidebar.js`)
- Existing modal patterns (agent-picker, close-modal) for consistency

## Out of Scope
- Inline spec editing within the dashboard (too complex, agent does this better)
- Creating research topics or feedback items from dashboard (future features)
- Editing or re-opening existing specs from dashboard cards (future feature)
- Pre-populating the spec with AI-generated content before opening the agent (the agent does this live)

## Open Questions
- Does `/api/session/ask` currently support passing an initial message/prompt? If not, a small backend addition is needed to pass `message` in the POST body and forward it to the agent CLI

## Related
- `lib/commands/feature.js` — `feature-create` handler
- `templates/dashboard/js/sidebar.js` — `runAskAgent()`, `/api/session/ask`
- `templates/dashboard/js/actions.js` — `requestAction()` pattern
- `templates/dashboard/index.html` — modal patterns (agent-picker, close-modal)
