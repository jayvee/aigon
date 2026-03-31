# Feature: Feature Status Panel — Deep Status on Demand

## Summary

Replace the broken heartbeat/polling system with a pull-based "deep status" that's computed on demand when a user asks for it. The card on the dashboard shows a summary (lifecycle + agent name). When you want more, you click the card and a detail panel slides open with the full picture: session state, commit progress, cost, spec criteria. The same data is available via `aigon feature-status <ID>` in the terminal. The data comes from a single API endpoint (`/api/feature-status/:id`) that any interface can consume.

## Architecture

### Two layers of status

**Card status** (what's on the Kanban card now — lightweight, polled):
- Feature name, ID, lifecycle stage
- Agent name + simple alive/dead indicator (tmux check on each poll)
- Primary action button

**Deep status** (computed on demand when panel opens or CLI runs):
- Session: tmux alive, pid, uptime
- Progress: commit count, last commit time, files changed, lines +/-
- Cost: tokens in/out, estimated USD
- Spec: criteria checklist, spec path, log path
- Actions: Open, Restart, Close

### Data source: `collectFeatureDeepStatus(repoPath, featureId)`

A single function in `lib/feature-status.js` that gathers everything on demand:

```js
function collectFeatureDeepStatus(repoPath, featureId) {
    return {
        // Identity
        id, name, lifecycle, mode, startedAt,

        // Session (check RIGHT NOW, not cached)
        session: { tmuxAlive, sessionName, pid, uptimeSeconds },

        // Progress (read from git)
        progress: { commitCount, lastCommitAt, lastCommitMessage, filesChanged, linesAdded, linesRemoved },

        // Cost (read from transcript telemetry)
        cost: { inputTokens, outputTokens, estimatedUsd, model },

        // Spec (read from spec file)
        spec: { criteriaTotal, criteriaDone, specPath, logPath },

        // Extensible — add new sections here
        // e.g. devServer: { running, port, url }
        // e.g. security: { gitleaksClean, lastScanAt }
    }
}
```

This function is the single source for all status data. New signals get added here — not scattered across dashboard-server, supervisor, or collector modules.

### Three consumers, same data

1. **Dashboard panel** — `GET /api/feature-status/:id` → renders in slide-out panel
2. **CLI** — `aigon feature-status <ID>` → prints formatted grid to terminal
3. **Future UIs** — same API endpoint, render however they want

## User Stories

- [ ] As a user, I want to click a feature card and see exactly what's happening — is it alive, making progress, how much it's cost
- [ ] As a user, I want to run `aigon feature-status 198` in the terminal and get the same information
- [ ] As a developer, I want to add new status signals (dev server, security scan) without touching dashboard rendering code

## Acceptance Criteria

### API and data layer
- [ ] New module `lib/feature-status.js` with `collectFeatureDeepStatus(repoPath, featureId)` — computes everything on demand, no caching, no polling
- [ ] New API endpoint `GET /api/feature-status/:id` returns the deep status as JSON
- [ ] Function is extensible — adding a new section is adding a property to the return object, nothing else
- [ ] Works for both features and research entities

### Dashboard UX
- [ ] Clicking a feature card opens the existing spec drawer (slide-out panel) with a new **Status** tab alongside Spec, Events, Agents, Stats, Control
- [ ] Status tab renders the deep status grid: Session, Progress, Cost, Spec sections
- [ ] Session section shows: tmux alive/dead indicator, session name, uptime
- [ ] Progress section shows: commit count, last commit time + message, files changed, lines +/-
- [ ] Cost section shows: tokens, estimated USD, model
- [ ] Spec section shows: criteria done/total, paths
- [ ] Action buttons at bottom: Open (attach tmux), Restart (kill + relaunch), Close (feature-close)
- [ ] Data is fetched when the tab opens — not polled, not cached

### CLI
- [ ] `aigon feature-status <ID>` prints a formatted grid to the terminal with the same sections
- [ ] Works from main repo or from within a worktree

### Replaces heartbeat for card status
- [ ] The card's alive/dead indicator uses a tmux session check on each dashboard poll — not heartbeat files, not engine signals
- [ ] Heartbeat sidecar continues to run (it's cheap) but is not used for status display
- [ ] Feature 198 (supervisor heartbeat bridge) can be deprioritised or closed as won't-fix

## Validation

```bash
node -c lib/feature-status.js
node -c lib/dashboard-server.js
node -c aigon-cli.js

# feature-status module exists and exports the collector
node -e "const fs = require('./lib/feature-status'); console.log(typeof fs.collectFeatureDeepStatus)"

# CLI command exists
aigon feature-status 198 2>&1 | head -5
```

## Technical Approach

### 1. Create `lib/feature-status.js` (~150 lines)

Single function, no dependencies on dashboard or supervisor. Reads:
- Workflow snapshot for lifecycle, agents, timestamps
- `tmux has-session` for session state
- `git log` in worktree for commit progress
- Transcript telemetry files for cost
- Spec file for criteria (count `- [ ]` vs `- [x]`)

### 2. Add API endpoint to `dashboard-server.js` (~10 lines)

```js
// GET /api/feature-status/:id
const deepStatus = collectFeatureDeepStatus(repoPath, featureId);
return res.json(deepStatus);
```

### 3. Add Status tab to spec drawer (~80 lines of HTML/JS)

The spec drawer already has tabs (Spec, Events, Agents, Stats, Control). Add a Status tab that fetches `/api/feature-status/:id` on open and renders the grid sections.

### 4. Add CLI command (~30 lines)

`aigon feature-status <ID>` calls `collectFeatureDeepStatus()` and formats as a terminal grid using existing `printSpecInfo` patterns.

### 5. Simplify card status

On each dashboard poll, check `tmux has-session` for each agent's expected session name. Show alive/dead. No heartbeat files, no engine signals, no supervisor.

### Key files:
- NEW: `lib/feature-status.js` — the collector
- `lib/dashboard-server.js` — add API endpoint
- `templates/dashboard/js/spec-drawer.js` — add Status tab
- `lib/commands/misc.js` or `lib/commands/feature.js` — add CLI command

## Dependencies

- None (uses existing worktree, git, telemetry, spec infrastructure)

## Out of Scope

- Removing the heartbeat sidecar (it's harmless, keep it)
- Real-time streaming of agent output to the dashboard
- Historical status tracking (this is a point-in-time snapshot)

## Open Questions

- Should the Restart button preserve uncommitted changes (stash before kill) or just kill and relaunch?
- Should criteria parsing be smarter than counting `- [ ]` / `- [x]` checkboxes?

## Related

- Feature 198: Supervisor Heartbeat Bridge (may be deprioritised — this replaces its purpose)
- Feature 190: Centralise UI Actions (actions on the panel should come from the engine)
- Feature 191: Simplify Feature-Close (the Close button on the panel triggers this)
