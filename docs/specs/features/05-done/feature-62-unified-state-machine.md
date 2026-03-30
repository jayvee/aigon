# Feature: unified-state-machine

## Summary

Extract all feature/research/feedback lifecycle logic — stages, transitions, available actions, and context-dependent behaviour — into a single, declarative state machine module. Every surface in Aigon (CLI commands, Radar API, dashboard UI, next-action inference) consumes this one definition instead of reimplementing transition rules, guard conditions, and action availability independently.

Today the same lifecycle knowledge is spread across `lib/commands/shared.js` (CLI guards and `moveFile` calls), `lib/utils.js` (Radar status collection, next-action inference, interactive action allowlist, tmux session management), and `templates/dashboard/index.html` (Kanban drag-drop rules, button rendering per stage, agent picker logic). When any of these diverge — as they have repeatedly — the result is regressions: duplicate tmux sessions, buttons that trigger invalid transitions, or "Open" actions that silently do nothing because the session contract doesn't match.

The state machine encodes:
- **What stages exist** for each entity type (feature, research, feedback).
- **What transitions are valid** from each stage, and what command/side-effect each transition triggers.
- **What in-state actions are available** — actions that don't change the stage but are essential to the workflow (launching an agent, attaching to a session, stopping work).
- **What context modifies the graph** — solo vs fleet, worktree vs branch, agent status, terminal backend.
- **What actions are available** at each state for each surface (CLI, dashboard button, drag-drop, next-action suggestion).

### The `worktree-open` problem

The most visible symptom of missing state machine is `worktree-open`. This command is the action that actually **starts work** — it creates a terminal session and launches the agent CLI, which runs `feature-do`. But:

1. **It's named after an implementation detail** (worktrees) rather than the workflow concept (launching/starting an agent on a feature). A drive-mode feature has no worktree, but the user still needs to "open" or "start" it.
2. **It's not in the `feature-*` namespace**, so it's invisible to the action inference system — `inferDashboardNextActions` never suggests it, even though it's the most common action after `feature-setup`.
3. **It conflates three distinct operations**: creating a session, starting the agent, and opening a terminal window. The state machine needs to model these separately because the correct behaviour depends on what already exists.
4. **The dashboard "Open cc" button** calls `/api/worktree-open` directly, bypassing any state validation. There's no check that the feature is actually in-progress, that the agent was set up, or that a worktree exists.

In the state machine, this becomes `feature-open` — a first-class in-state action available in `in-progress`, with guards and session resolution logic that the dashboard, CLI, and next-action system all share.

## User Stories

- [ ] As a developer working on the dashboard, I want one source of truth for which buttons to render in each stage, so I don't accidentally show "Evaluate" when agents are still implementing.
- [ ] As a developer adding a new CLI command, I want to look up valid transitions in a single file rather than grep through three separate files to understand what's allowed.
- [ ] As an operator using the dashboard, I want the "Open" button to always do the right thing — start the agent if no session exists, reattach if one is running — without me needing to know the internal session state.
- [ ] As an operator, I want the dashboard and CLI to offer the same actions for the same state, so behaviour is predictable regardless of which surface I use.
- [ ] As a developer adding a new entity type or stage, I want to define it in one place and have all surfaces pick it up automatically.

## Acceptance Criteria

### State machine module

- [ ] A new module `lib/state-machine.js` exports the lifecycle definitions for features, research, and feedback.
- [ ] Each entity type defines its ordered stages, valid transitions, and the command each transition invokes.
- [ ] Transitions have guard conditions expressed as predicate functions over a context object (not string comparisons scattered in calling code).
- [ ] The context object includes: `mode` (solo/fleet), `hasWorktree`, `agentStatuses` (map of agent → status), `terminalBackend` (tmux/warp/iterm2), `agentCount`, `tmuxSessionState` (running/exited/none).
- [ ] The module is pure (no I/O, no filesystem access, no tmux calls) — it receives context and returns decisions.
- [ ] `node --check lib/state-machine.js` passes.

### Feature lifecycle

- [ ] Stages: `inbox → backlog → in-progress → in-evaluation → done`.

#### Stage transitions

Transitions move a feature from one stage to the next. Each has a guard condition that must be true.

| From | To | Command | Guard | UI trigger |
|------|-----|---------|-------|------------|
| inbox | backlog | `feature-prioritise` | always | Drag-drop, Prioritise button |
| backlog | in-progress | `feature-setup` | always | Setup button (shows agent picker) |
| in-progress | in-evaluation | `feature-eval` | all agents submitted | Evaluate button |
| in-evaluation | done | `feature-close` | always | Close button |

#### In-state actions

Actions that can be performed while remaining in the same stage. These are the operations the user performs most frequently — launching agents, monitoring progress, intervening when agents are stuck.

- [ ] The state machine distinguishes **transitions** (stage changes) from **in-state actions** (operations within a stage).
- [ ] In-state actions are returned by `getAvailableActions` alongside transitions, each tagged with its type (`transition` or `action`).

**`in-progress` stage — per-agent actions:**

| Agent state | Session state | Action | Label | What it does |
|------------|---------------|--------|-------|-------------|
| idle (set up, not started) | none | `feature-open` | "Open [agent]" | Create session, start agent, open terminal |
| implementing | running (agent alive) | `feature-attach` | "Attach [agent]" | Open terminal attached to running session |
| implementing | none (e.g. warp/vscode) | `feature-open` | "Open [agent]" | Create session, start agent |
| waiting | running | `feature-focus` | "Focus [agent]" | Bring terminal to front, agent needs input |
| waiting | any | `feature-stop` | "Stop [agent]" | Kill the agent session |
| submitted | any | — | — | No per-agent action; stage transition (Evaluate/Close) takes over |
| error | running (shell alive) | `feature-open` | "Restart [agent]" | Send agent command into existing session |
| error | none | `feature-open` | "Restart [agent]" | Create session, start agent |

**`in-progress` stage — feature-level actions (depend on aggregate agent state + mode):**

| Context | Available Actions |
|---------|------------------|
| Fleet, agents set up but not started | Open [agent] per agent |
| Fleet, all implementing | Attach [agent] per agent |
| Fleet, some waiting | Focus waiting agent, Stop agent |
| Fleet, all submitted | Evaluate |
| Solo, not started | Open |
| Solo, implementing | Attach |
| Solo, waiting | Focus, Stop |
| Solo, submitted | Close, Review, Evaluate |

**`in-evaluation` stage:**

| Context | Available Actions |
|---------|------------------|
| Solo | Review, Close |
| Fleet | Evaluate (continue), Close with [winner] |

**`backlog` stage:**

| Context | Available Actions |
|---------|------------------|
| any | Setup (solo), Setup Fleet |

- [ ] In-progress sub-states (per agent): `idle → implementing → waiting → submitted`, with `error` reachable from any active state.

#### `feature-open` — the unified launch action

- [ ] `feature-open` replaces `worktree-open` as the canonical name for "start/resume an agent on a feature".
- [ ] `worktree-open` becomes a deprecated alias that delegates to `feature-open`.
- [ ] `feature-open` is context-aware: it works for both worktree-based (fleet/single-agent worktree) and branch-based (drive) modes. In drive mode without a worktree, it opens the current directory and starts the agent.
- [ ] The dashboard "Open [agent]" button calls `feature-open` (via `/api/action` or a dedicated endpoint), not `/api/worktree-open` directly.
- [ ] `feature-open` appears in next-action inference — after `feature-setup`, the recommended action is `feature-open` (not a manual instruction to run `worktree-open`).

### Research lifecycle

- [ ] Stages: `inbox → backlog → in-progress → paused → done`.
- [ ] Transitions and guards defined equivalently to features.

### Feedback lifecycle

- [ ] Stages: `inbox → triaged → actionable → done` (plus `wont-fix`, `duplicate` as terminal states reachable from triaged).
- [ ] Transitions and guards defined equivalently.

### Session actions

- [ ] The state machine defines session-level actions (open, attach, restart, stop) as a function of `tmuxSessionState` and `agentStatus`:

| tmuxSessionState | agentStatus | "Open" action |
|------------------|-------------|---------------|
| none | any | Create session + start agent |
| running (agent alive) | implementing/waiting | Attach to session |
| running (agent exited) | submitted/error | Send agent command via send-keys |
| exited | any | Create session + start agent |

- [ ] This replaces the current split between `ensureTmuxSessionForWorktree` (startup-command approach) and `ensureAgentSessions` (send-keys approach) with one consistent strategy.

### CLI integration

- [ ] CLI commands (`feature-setup`, `feature-eval`, `feature-close`, etc.) validate transitions through the state machine instead of ad-hoc `findFile` + stage array checks.
- [ ] Guard failures produce consistent error messages that include the current state and the list of valid transitions from that state.
- [ ] The state machine replaces the hardcoded action allowlist (`RADAR_INTERACTIVE_ACTIONS` set) with a dynamic check: "is this action a valid transition from the entity's current state?"

### Dashboard integration

- [ ] The `/api/status` response includes a `validActions` array per feature/research/feedback item, computed by the state machine from the current stage and context.
- [ ] The dashboard renders buttons and drag-drop targets based on `validActions` instead of hardcoded stage checks in the HTML.
- [ ] `ALLOWED_TRANSITIONS` in the dashboard HTML is removed — transitions are validated server-side and the response tells the UI what's allowed.
- [ ] `inferDashboardNextCommand` and `inferDashboardNextActions` are replaced by a single `getRecommendedActions(state, context)` function in the state machine module, called from status collection.

### Next-action inference

- [ ] The state machine provides a `getRecommendedActions(state, context)` function that returns an ordered list of suggested actions with labels, commands, and modes (fire-and-forget, interactive, etc.).
- [ ] This replaces both `inferDashboardNextCommand` and `inferDashboardNextActions` in `lib/utils.js`.

## Validation

```bash
node --check lib/state-machine.js
npm test
```

## Technical Approach

### Module structure

The state machine has two types of entries: **transitions** (change stage) and **actions** (operate within a stage).

```javascript
// lib/state-machine.js

const FEATURE_STAGES = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];
const AGENT_STATUSES = ['idle', 'implementing', 'waiting', 'submitted', 'error'];

// Stage transitions — move a feature from one stage to the next
const FEATURE_TRANSITIONS = [
  {
    type: 'transition',
    from: 'inbox',
    to: 'backlog',
    action: 'feature-prioritise',
    guard: () => true,
    label: 'Prioritise'
  },
  {
    type: 'transition',
    from: 'backlog',
    to: 'in-progress',
    action: 'feature-setup',
    guard: () => true,
    label: 'Setup',
    requiresInput: 'agentPicker'  // tells UI to show agent picker modal
  },
  {
    type: 'transition',
    from: 'in-progress',
    to: 'in-evaluation',
    action: 'feature-eval',
    guard: (ctx) => allAgentsSubmitted(ctx),
    label: 'Evaluate'
  },
  {
    type: 'transition',
    from: 'in-evaluation',
    to: 'done',
    action: 'feature-close',
    guard: () => true,
    label: 'Close'
  }
];

// In-state actions — operate within a stage without changing it
const FEATURE_ACTIONS = [
  // After setup, before agents have started
  {
    type: 'action',
    stage: 'in-progress',
    action: 'feature-open',
    guard: (ctx, agentId) => {
      const status = ctx.agentStatuses[agentId];
      return status === 'idle' || status === 'error';
    },
    label: (ctx, agentId) => ctx.agentStatuses[agentId] === 'error'
      ? `Restart ${agentId}`
      : `Open ${agentId}`,
    perAgent: true,       // rendered once per agent that passes the guard
    mode: 'terminal'      // opens a terminal
  },
  // Agent is running — attach to view progress
  {
    type: 'action',
    stage: 'in-progress',
    action: 'feature-attach',
    guard: (ctx, agentId) =>
      ctx.agentStatuses[agentId] === 'implementing' &&
      ctx.tmuxSessionStates[agentId] === 'running',
    label: (ctx, agentId) => `Attach ${agentId}`,
    perAgent: true,
    mode: 'terminal'
  },
  // Agent is waiting — bring terminal to front
  {
    type: 'action',
    stage: 'in-progress',
    action: 'feature-focus',
    guard: (ctx, agentId) => ctx.agentStatuses[agentId] === 'waiting',
    label: (ctx, agentId) => `Focus ${agentId}`,
    perAgent: true,
    mode: 'terminal',
    priority: 'high'      // surfaces as the recommended next action
  },
  // Stop a running agent
  {
    type: 'action',
    stage: 'in-progress',
    action: 'feature-stop',
    guard: (ctx, agentId) => {
      const s = ctx.agentStatuses[agentId];
      return s === 'implementing' || s === 'waiting';
    },
    label: (ctx, agentId) => `Stop ${agentId}`,
    perAgent: true,
    mode: 'fire-and-forget'
  },
  // Solo submitted — close without eval
  {
    type: 'action',
    stage: 'in-progress',
    action: 'feature-close',
    guard: (ctx) => ctx.mode === 'solo' && allAgentsSubmitted(ctx),
    label: () => 'Close',
    perAgent: false,
    mode: 'fire-and-forget'
  },
  // Solo submitted — get a review first
  {
    type: 'action',
    stage: 'in-progress',
    action: 'feature-review',
    guard: (ctx) => ctx.mode === 'solo' && allAgentsSubmitted(ctx),
    label: () => 'Review',
    perAgent: false,
    mode: 'agent'
  },
  // In-evaluation: continue eval (fleet) or review (solo)
  {
    type: 'action',
    stage: 'in-evaluation',
    action: 'feature-eval',
    guard: (ctx) => ctx.mode === 'fleet',
    label: () => 'Evaluate',
    perAgent: false,
    mode: 'agent'
  },
  {
    type: 'action',
    stage: 'in-evaluation',
    action: 'feature-review',
    guard: (ctx) => ctx.mode === 'solo',
    label: () => 'Review',
    perAgent: false,
    mode: 'agent'
  }
];
```

### Context object

```javascript
/**
 * @typedef {Object} StateContext
 * @property {'solo'|'fleet'} mode
 * @property {boolean} hasWorktree
 * @property {Object<string, 'idle'|'implementing'|'waiting'|'submitted'|'error'>} agentStatuses
 * @property {string[]} agents - list of agent IDs (e.g. ['cc', 'gg'])
 * @property {number} agentCount
 * @property {'tmux'|'warp'|'iterm2'|'terminal'} terminalBackend
 * @property {Object<string, 'running'|'exited'|'none'>} tmuxSessionStates
 * @property {string} currentStage
 * @property {string} entityType - 'feature' | 'research' | 'feedback'
 */
```

### Query functions

```javascript
// What transitions can happen from the current state?
function getValidTransitions(entityType, currentStage, context) { ... }

// What actions are available for this entity right now?
// Returns both transitions and in-state actions, each tagged with type.
// Per-agent actions are expanded: one entry per agent that passes the guard.
function getAvailableActions(entityType, currentStage, context) { ... }

// What should the "Open" button do for this agent?
// Resolves to create-and-start, attach, or send-keys based on session + agent state.
function getSessionAction(agentId, context) { ... }

// What's the recommended next action? (replaces inferDashboardNextCommand)
// Returns the highest-priority action from getAvailableActions.
function getRecommendedActions(entityType, currentStage, context) { ... }

// Is this CLI command valid for the current state?
function isActionValid(action, entityType, currentStage, context) { ... }
```

### Session action resolution

This directly addresses the recurring "Open" button regression. Instead of multiple code paths deciding how to handle sessions, one function resolves it:

```javascript
function getSessionAction(agentId, context) {
  const sessionState = context.tmuxSessionStates[agentId] || 'none';
  const agentStatus = context.agentStatuses[agentId] || 'idle';

  if (sessionState === 'none' || sessionState === 'exited') {
    return { action: 'create-and-start', needsAgentCommand: true };
  }

  // Session exists — is the agent process still alive inside it?
  if (agentStatus === 'implementing' || agentStatus === 'waiting') {
    return { action: 'attach' };
  }

  // Session alive but agent finished (submitted/error) — restart agent in existing session
  return { action: 'send-keys', needsAgentCommand: true };
}
```

The `/api/worktree-open` handler and `ensureTmuxSessionForWorktree` both call this function instead of implementing their own logic.

### Migration strategy

1. **Phase 1**: Create `lib/state-machine.js` with the lifecycle definitions (transitions + in-state actions) and query functions. Write tests for every transition, guard, and per-agent action expansion.
2. **Phase 2**: Rename `worktree-open` to `feature-open`. Add `worktree-open` as a deprecated alias. Update `/api/worktree-open` endpoint to delegate to the same logic, or add `/api/action` support for `feature-open`. Update dashboard "Open [agent]" buttons to use the new action path.
3. **Phase 3**: Wire `getAvailableActions` into `/api/status` as `validActions`. Update dashboard to render buttons from `validActions` instead of hardcoded stage checks. Keep old rendering as fallback during transition.
4. **Phase 4**: Refactor CLI commands to validate via `isActionValid` instead of ad-hoc `findFile` stage checks. Replace `RADAR_INTERACTIVE_ACTIONS` with dynamic validation.
5. **Phase 5**: Unify session management through `getSessionAction`. Remove `ensureAgentSessions` and consolidate into a single `ensureSession` function that delegates to the state machine for strategy.
6. **Phase 6**: Remove all replaced code — `ALLOWED_TRANSITIONS` from dashboard HTML, `inferDashboardNextCommand`/`inferDashboardNextActions` from utils.js, hardcoded button logic from dashboard, `/api/worktree-open` endpoint (replaced by `/api/action` with `feature-open`).

Each phase is independently shippable and testable.

### What the state machine does NOT own

- **Filesystem operations**: the state machine does not move files or create worktrees. It returns a decision; the caller executes it.
- **tmux/terminal commands**: the state machine does not call `spawnSync('tmux', ...)`. It returns `{ action: 'attach' }` and the caller knows how to attach.
- **UI rendering**: the state machine does not produce HTML. It returns `{ label: 'Evaluate', action: 'feature-eval', style: 'primary' }` and the dashboard renders it.

## Dependencies

- Feature 45: AIGON server (provides `/api/status` response structure)
- Feature 55: Interactive API (provides `POST /api/action` — will be refactored to validate via state machine)
- Feature 57: Dashboard Pipeline view (consumes stage/action data — will read from `validActions`)

## Out of Scope

- Changing the actual stage directory names (`01-inbox`, `02-backlog`, etc.) — the state machine abstracts over these.
- Adding new stages or entity types — this feature extracts existing logic; new stages are a separate feature.
- Persistent state storage or database — the filesystem-and-git model remains unchanged.
- Automated testing of the full CLI → dashboard round-trip (that's an integration test feature).

## Open Questions

- Should the state machine also encode research agent-level sub-states (conducting, synthesizing), or keep those as simple directory-based stages for now?
- Should `validActions` be computed eagerly (on every poll) or lazily (on demand via a separate API call)?  Eagerly is simpler and the computation is lightweight.
- Should the state machine support "undo" transitions (e.g., moving a feature back from in-progress to backlog)?  Current workflow doesn't support this, but the state machine could encode it.

## Related

- Feature 45: [Aigon Radar](../../05-done/feature-45-aigon-radar.md)
- Feature 55: [Interactive API](../../05-done/feature-55-interactive-actions.md)
- Feature 57: [Dashboard Pipeline](../../03-in-progress/feature-57-control-surface-dashboard-operator-console.md)
