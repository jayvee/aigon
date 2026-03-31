# Feature: Centralise all UI actions into engine action registry

## Summary

After feature 185 migrated lifecycle actions to the engine, 18+ non-workflow UI actions remain scattered across dashboard frontend files (pipeline.js, monitor.js, sidebar.js, init.js). A macOS app or any alternative UI would need to reimplement all of them. This feature creates a unified action registry where ALL user-facing actions — workflow and infra — are defined in one place, with eligibility guards, metadata, and API routing, so any UI surface can discover and render them from a single API response.

## Background

Feature 185 established the pattern: `deriveAvailableActions()` produces an array of action objects with kind, label, guard, category, and metadata. The dashboard renders them from `validActions` in the API response. But this only covers workflow actions (start, pause, close, etc.). Infra actions like "Start preview", "Submit" (session-ended), "View findings", and "Ask agent" are still hardcoded in dashboard JS with eligibility logic spread across collector, pipeline, and monitor code.

### Current state: where non-workflow actions live

| Action | Eligibility | UI | API |
|--------|------------|-----|-----|
| Dev server poke (Start preview) | `dashboard-status-collector.js` | `pipeline.js` | `/api/repos/.../dev-server/poke` |
| Main dev server start | `sidebar.js` | `sidebar.js` | `/api/repos/.../dev-server/start` |
| Flag: Submit (mark-submitted) | `pipeline.js` (sessionEnded) | `pipeline.js` | `/api/agent-flag-action` |
| Flag: Re-open | `pipeline.js` (sessionEnded) | `pipeline.js` | `/api/agent-flag-action` |
| Flag: View work | `pipeline.js` (sessionEnded) | `pipeline.js` | `/api/agent-flag-action` |
| View research findings | `pipeline.js` (findingsPath) | `pipeline.js` | `openPeekPanel()` client-side |
| View eval results | `pipeline.js` (evalPath) | `pipeline.js` | `openDrawer()` client-side |
| Open eval session | `pipeline.js` (evalSession.running) | `pipeline.js` | `requestFeatureOpen()` |
| View review session | `actions.js` (reviewSessions) | `actions.js` | `openPeekPanel()` client-side |
| Open review session | `pipeline.js` (review.running) | `pipeline.js` | `requestFeatureOpen()` |
| Session: Open (tmux) | `init.js` | `init.js` | `/api/session/view` |
| Session: Peek | `init.js` | `init.js` | `openPeekPanel()` client-side |
| Session: Kill | `init.js` | `init.js` | `/api/session/stop` |
| Ask agent | `sidebar.js` | `sidebar.js` | `/api/session/ask` |
| Create feature | `pipeline.js` | `pipeline.js` | `/api/action` |
| Open spec (click card) | `pipeline.js` | `pipeline.js` | `openDrawer()` client-side |
| Copy next command | `monitor.js` | `monitor.js` | `copyText()` client-side |
| Attach session | `monitor.js` | `monitor.js` | `/api/attach` |

## User Stories

- [ ] As a developer building a macOS app, I want all available actions from one API endpoint so I don't reimplement eligibility logic
- [ ] As a developer adding a new action, I want one place to define it with clear conventions so I don't scatter logic across frontend files
- [ ] As a user, I want consistent action availability across dashboard, board, and future UIs

## Acceptance Criteria

### Unified action registry
- [ ] All actions (workflow AND infra) defined in a central registry with consistent shape
- [ ] Each action has: `kind`, `label`, `category`, `scope` (per-agent/per-feature/per-repo), `guard` function, `metadata` (requiresInput, clientOnly, apiEndpoint, etc.)
- [ ] Two clear categories: `workflow` (affect lifecycle state) and `infra` (session management, dev server, viewing, utilities)
- [ ] Registry is importable by any consumer (dashboard, board, macOS app, API)

### Infra actions migrated to registry
- [ ] Dev server poke: guard checks `devServerPokeEligible && !devServerUrl`, per-agent, category `infra`
- [ ] Main dev server start: guard checks `mainDevServerEligible && !mainDevServerRunning`, per-repo, category `infra`
- [ ] Session-ended flag actions (Submit, Re-open, View work): guard checks `agent.flags.sessionEnded`, per-agent, category `infra`
- [ ] View research findings: guard checks `agent.findingsPath`, per-agent, category `view`
- [ ] View eval results: guard checks `feature.evalPath`, per-feature, category `view`
- [ ] Open eval session: guard checks `evalSession.running`, per-feature, category `infra`
- [ ] View/Open review session: guard from `feature.reviewSessions`, per-feature, category `view`

### API contract
- [ ] `/api/status` response includes infra actions alongside workflow actions in `validActions` (or a separate `infraActions` array if cleaner)
- [ ] Each action object includes enough metadata for any UI to render and dispatch it without hardcoded knowledge
- [ ] Client-only actions (open drawer, copy text) marked with `clientOnly: true` — UI can render them but they don't hit an API

### Dashboard updated to consume registry
- [ ] `pipeline.js` agent section renders per-agent infra actions from the API response, not from hardcoded checks
- [ ] `monitor.js` dev server actions come from the API response
- [ ] `sidebar.js` repo-level actions come from the API response (or a repo-level action list)
- [ ] Frontend files contain only rendering and dispatch logic, zero eligibility computation

### Agent instructions updated
- [ ] `CLAUDE.md` updated with rule: "Never add action buttons or eligibility logic in dashboard frontend files. All actions must be defined in the central action registry."
- [ ] `docs/architecture.md` updated with action registry documentation
- [ ] Template dashboard files include a comment header: "Actions rendered from API — do not add action eligibility logic here"

## Technical Approach

### Phase 1: Design the registry shape

Extend the existing `FEATURE_ACTION_CANDIDATES` / `RESEARCH_ACTION_CANDIDATES` pattern. Add a new category system:

```js
// Categories
const ActionCategory = {
    WORKFLOW: 'workflow',   // Affects lifecycle state (start, pause, close, eval)
    SESSION: 'session',     // Terminal session management (open, attach, kill)
    INFRA: 'infra',         // Infrastructure (dev server, flags)
    VIEW: 'view',           // Read-only viewing (findings, eval, review, spec)
};
```

Infra action candidates follow the same shape as workflow candidates:
```js
{
    kind: 'dev-server-poke',
    label: 'Start preview',
    category: ActionCategory.INFRA,
    scope: 'per-agent',
    bypassMachine: true,
    guard: ({ agent }) => agent.devServerPokeEligible && !agent.devServerUrl,
    metadata: { apiEndpoint: 'dev-server/poke' },
}
```

### Phase 2: Separate workflow and infra candidate lists

Keep `FEATURE_ACTION_CANDIDATES` for workflow actions (XState-validated).
Add `FEATURE_INFRA_CANDIDATES` for infra actions (always bypassMachine).
Add `FEATURE_VIEW_CANDIDATES` for view-only actions (client-side, no API call).

`deriveAvailableActions()` merges all three lists and filters by guards.

### Phase 3: Wire infra actions through the status collector

The collector already computes `devServerPokeEligible`, `findingsPath`, `sessionEnded` etc. Instead of putting these as ad-hoc fields on the agent object, pass them as context to the action derivation so guards can evaluate.

### Phase 4: Dashboard consumes unified actions

Replace hardcoded buttons in pipeline.js/monitor.js with rendering from the unified `validActions` (or `infraActions`) array.

### Files changed

1. **`lib/workflow-core/types.js`** — new ActionCategory enum, new ManualActionKind values for infra actions
2. **`lib/feature-workflow-rules.js`** — add FEATURE_INFRA_CANDIDATES
3. **`lib/research-workflow-rules.js`** — add RESEARCH_INFRA_CANDIDATES
4. **`lib/workflow-core/actions.js`** — merge infra candidates into derivation
5. **`lib/workflow-snapshot-adapter.js`** — descriptors for infra actions
6. **`lib/dashboard-status-collector.js`** — pass infra context to action derivation
7. **`templates/dashboard/js/pipeline.js`** — consume from validActions, remove hardcoded buttons
8. **`templates/dashboard/js/monitor.js`** — same
9. **`templates/dashboard/js/sidebar.js`** — repo-level actions from API
10. **`CLAUDE.md`** — add rule about action registry
11. **`docs/architecture.md`** — document action registry

## Dependencies

- Feature 185 (engine-driven workflow actions) — done, this builds on it

## Out of Scope

- Repo-level actions (Ask agent, Create feature) — these don't have per-entity eligibility and may stay as global UI affordances
- Drag-drop stage transitions — already engine-driven via validActions
- macOS app implementation — this feature makes it possible, doesn't build it
- Copy/utility actions — these are UI-only affordances, not worth registering

## Open Questions

- Should infra actions live in the same `validActions` array or a separate `infraActions` array in the API response? Same array is simpler but mixes concerns. Separate array is clearer but requires two iteration passes in UIs.
- Should view-only actions (open drawer, peek) be in the registry at all? They don't hit APIs — they're client-side navigation. A `clientOnly: true` flag could mark them, or they could stay as UI affordances.

## Related

- Feature 185 — engine-driven workflow actions (the foundation this builds on)
- `FEATURE_STAGE_ACTIONS` table (`feature-workflow-rules.js`) — original source of truth for stage actions
- `FEATURE_ACTION_CANDIDATES` — current workflow action candidates
