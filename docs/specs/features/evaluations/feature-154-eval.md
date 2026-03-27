# Evaluation: Feature 154 - dashboard-dev-server-actions

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-154-dashboard-dev-server-actions.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-154-cc-dashboard-dev-server-actions`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-154-cx-dashboard-dev-server-actions`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 7/10 | 8/10 |
| Spec Compliance | 8/10 | 9/10 |
| Performance | 7/10 | 8/10 |
| Maintainability | 6/10 | 8/10 |
| **Total** | **28/40** | **33/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | +293/-3 | 28/40 |
| cx | +462/-44 | 33/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Concise implementation: both endpoints and both frontend components delivered in fewer lines
  - Good visual design: custom SVG icons for both the globe (running/stopped states) and the poke button (play icon with dashed circle), plus `pulse-opacity` animation for the "starting" state
  - Proper event delegation via `document.addEventListener('click')` for both globe and poke buttons
  - Globe button updates in-place after successful start (switches class from `stopped` to `running`, sets `data-dev-url`, opens browser) without waiting for a poll cycle
  - Status guard in poke endpoint correctly checks agent status and has a secondary check for `implementing` with inactive tmux
- Weaknesses:
  - **Uses `spawnSync` directly** instead of `runDashboardInteractiveAction()` — bypasses the existing action-execution pattern that handles logging, error formatting, and repo resolution. This is the biggest maintainability concern.
  - **Body-based repo path** (`POST /api/dev-server/start` with `{ repoPath }` in JSON body) instead of the spec's RESTful URL pattern (`POST /api/repos/:repo/dev-server/start`). This deviates from the spec and from the existing API URL pattern used by other endpoints.
  - **No "already running" fast path** for the main dev server start endpoint — always runs `spawnSync` even if the server is already up, relying on the CLI to be idempotent. CX explicitly checks and short-circuits.
  - Poke button eligibility logic is split across frontend (checking `agent.status` and `agent.tmuxRunning`) and backend (checking manifest file). This creates a potential desync where the button shows but the backend rejects.
  - No test coverage at all — no Playwright tests added.
  - Worktree path resolution in the poke endpoint uses a naive `fs.readdirSync` with string matching (`d.includes(featureId) && d.includes(agentId)`) instead of the existing `resolveFeatureWorktreePath()` helper, which could match incorrectly for overlapping IDs.

#### cx (Codex)
- Strengths:
  - **Proper use of existing patterns**: uses `runDashboardInteractiveAction()` for the start endpoint and `safeTmuxSessionExists()` + `resolveFeatureWorktreePath()` for the poke endpoint — these are the established abstractions the codebase provides
  - **RESTful URL design** matching the spec exactly: `POST /api/repos/:repo/dev-server/start` and `POST /api/repos/:repo/features/:id/agents/:agent/dev-server/poke`
  - **Server-side eligibility computation** (`devServerPokeEligible` flag computed in `collectDashboardStatusData()` via dedicated `isDevServerPokeEligible()` helper) — the frontend just reads a boolean, eliminating client/server desync
  - **Proper separation of concerns**: API functions live in `api.js`, state additions in `state.js`, UI rendering in `pipeline.js`/`sidebar.js` — follows the existing module boundary pattern
  - **Duplicate-request prevention** via `state.pendingActions` and `state.pendingDevServerPokes` sets — prevents double-clicks
  - **"Already running" fast path** in both endpoints — returns early with the URL if the server is already up, avoiding unnecessary CLI invocations
  - **Playwright test coverage**: two tests verifying the globe start API call and the poke button API call with proper route mocking
  - Profile check in the start endpoint (`getActiveProfile(repoPath).devServer.enabled`) — explicit guard beyond just the frontend flag
  - `resolveRepoFromPathParam()` and `findFeatureAgentInStatus()` helper functions are clean, reusable, and properly scoped
  - Wraps globe + Ask Agent buttons in a `repo-header-actions` flex container for proper layout
- Weaknesses:
  - Poke button uses a text "Start preview" button (`.btn .btn-secondary`) instead of the icon-based approach described in the spec ("Start preview button/icon"). Less visually integrated with the existing globe iconography, though arguably more discoverable.
  - More lines of code overall (462 vs 293), partly due to tests and partly due to more thorough validation. Some of the verbosity in the poke endpoint could be trimmed.
  - The `mainDevServerEligible` field name is slightly redundant with the existing `devServerEnabled` (CC reused `devServerEnabled` directly).
  - No CSS animation for loading/starting state on the globe (relies on spinner from `run-next-spinner` class). CC's `pulse-opacity` keyframe is more polished.

## Recommendation

**Winner:** cx

**Rationale:** CX delivers a more complete and maintainable implementation. The key differentiators:

1. **Pattern adherence**: CX uses `runDashboardInteractiveAction()`, `safeTmuxSessionExists()`, `resolveFeatureWorktreePath()`, and the `resolveRepoFromPathParam()` pattern — all existing abstractions. CC bypasses these with `spawnSync`, naive directory scanning, and body-based routing, creating maintenance burden when these patterns evolve.

2. **Spec compliance**: CX matches the spec's RESTful URL structure exactly. CC uses flat endpoints with body parameters, deviating from both the spec and existing API conventions.

3. **Server-side eligibility**: CX computes `devServerPokeEligible` server-side in the poll data, so the frontend is a pure renderer. CC splits eligibility logic across frontend and backend, risking desync.

4. **Test coverage**: CX includes two Playwright tests; CC has none.

5. **Robustness**: CX handles "already running" fast paths, duplicate-click prevention, profile validation, and proper URL encoding. CC lacks these guardrails.

## Cross-Pollination

Worth adopting from CC into the CX implementation:

- **CSS animations**: CC's `pulse-opacity` keyframe for the starting state is cleaner than CX's spinner-only approach. Add the keyframe animation to the globe button's starting state.
- **Icon-based poke button**: CC's play-icon SVG inside a circular button is more visually consistent with the globe iconography. Consider replacing CX's text "Start preview" button with CC's SVG approach for the poke action, or at minimum adding the icon alongside the text.
- **In-place globe state update**: CC updates the globe button's class and data attributes immediately after a successful start (before the next poll cycle). CX relies on `requestRefresh()` which introduces a brief delay. Adopting CC's optimistic UI update would feel snappier.
