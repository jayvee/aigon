# Implementation Log: Feature 109 - create-feature-from-dashboard
Agent: cx

## Plan
- Add a `+ New Feature` action in the Pipeline Inbox column header (features pipeline only).
- Wire a dashboard modal to collect feature name + optional rough description with client-side validation.
- Create the feature via `POST /api/action` using `feature-create`.
- Refresh board after creation, then open an ask-agent session seeded with spec path + user context.
- Keep creation independent from session handoff (harness errors as non-blocking toast).
- Add/adjust dashboard tests and run validation.

## Progress
- Added Inbox-header `+ New Feature` button in Pipeline column header (`templates/dashboard/index.html`).
- Extended the create modal with:
  - Name field (`maxlength=80`)
  - Optional multiline description field
  - Inline error display area
- Implemented modal workflow in `templates/dashboard/js/pipeline.js`:
  - open/close handlers
  - name validation (required + max length)
  - create submit path to `/api/action` with `{ action: 'feature-create', args: [name], repoPath }`
  - post-create board refresh
  - prompt construction including spec path, feature name, and description
  - ask-session handoff via `/api/session/ask`
  - non-blocking error toast when session handoff fails
- Updated `/api/session/ask` backend in `lib/dashboard-server.js`:
  - accepts `message` in addition to `prompt`
  - if ask session already exists, sends prompt into tmux session before attach
- Added modal/button coverage in `tests/dashboard/pipeline.spec.js`.
- Prompt-run notes from this session:
  - `aigon feature-do 109` from main warned to use setup; feature was already `in-progress`, so implementation continued in this feature's existing worktree branch.
  - `aigon agent-status implementing` was run from the worktree and succeeded.

## Decisions
- Kept creation on `/api/action` + `feature-create` (per acceptance criteria) instead of using `/api/spec/create`.
- Put the `+ New Feature` entry point in the Inbox column header (while preserving existing pipeline structure) to match the UX target.
- Treated agent handoff as best-effort by design: feature creation succeeds independently; ask-session failure surfaces via toast only.
- In `/api/session/ask`, `message` is accepted as an alias for `prompt` so dashboard UI can pass semantically clear payloads without breaking existing callers.

## Validation
- `node --check lib/dashboard-server.js`
- `node --check lib/commands/feature.js`
- `node --check templates/dashboard/js/pipeline.js`
- `DASHBOARD_URL=http://127.0.0.1:4106 npx playwright test tests/dashboard/pipeline.spec.js` (13 passed)
- `npm test` (173 passed, 1 pre-existing unrelated failure: `feature-eval --force bypasses the completion warning and creates the evaluation file`)
- Playwright screenshot captured after dashboard HTML edit (`temp/screenshots/feature-109-new-feature-modal.png`).

## Code Review

**Reviewed by**: cc (Claude Opus 4.6)
**Date**: 2026-03-19

### Findings
- **tmux send-keys key name injection**: In `lib/dashboard-server.js`, the existing-session path used `runTmux(['send-keys', '-t', sessionName, prompt, 'Enter'])` without the `-l` (literal) flag. Without `-l`, tmux interprets arguments as key names — if a user's feature description contains words like "Enter", "Escape", "Space", or "C-c", tmux sends those as key presses instead of literal text. This is a correctness bug and a mild security concern for the local environment.

### Fixes Applied
- `3cd03e8 fix(review): use tmux send-keys -l for literal text in ask session` — split into two `runTmux` calls: first with `-l` flag for literal prompt text, then a separate call for the `Enter` keypress.

### Notes
- Overall implementation is solid and well-structured. Good separation of concerns between modal UI, validation, action dispatch, and agent handoff.
- Toast uses `textContent` (not `innerHTML`), so no XSS risk from user-provided feature names — correctly done.
- The `message` alias for `prompt` in `/api/session/ask` is a clean backwards-compatible addition.
- Test coverage is thorough: modal open/close, validation, create+ask flow, and error display.
- The old global `+ Create` button was correctly removed and replaced with the column-scoped `+ New Feature` button.

## Conversation Summary
- User invoked `/prompts:aigon-feature-do 109` and then provided full feature-do workflow instructions.
- Implementation focused on dashboard UX + handoff plumbing to match acceptance criteria exactly.
- Validation included targeted dashboard tests and syntax checks; full suite had one unrelated existing failure.
