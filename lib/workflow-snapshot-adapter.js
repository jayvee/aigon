'use strict';

/**
 * Read adapter: maps workflow-core snapshots to dashboard/board data formats.
 *
 * All reads are side-effect free — reads snapshot.json directly, no locking.
 * Falls back to null when no workflow snapshot exists for a feature.
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const { getSnapshotPathForEntity, getEventsPathForEntity } = require('./workflow-core/paths');
const { LifecycleState, ManualActionKind, ActionCategory } = require('./workflow-core/types');
const {
  formatDashboardActionCommand,
  formatBoardActionCommand,
} = require('./action-command-mapper');

// ---------------------------------------------------------------------------
// Lifecycle → dashboard stage mapping
// ---------------------------------------------------------------------------

const LIFECYCLE_TO_STAGE = Object.freeze({
  [LifecycleState.BACKLOG]: 'backlog',
  [LifecycleState.IMPLEMENTING]: 'in-progress',
  [LifecycleState.REVIEWING]: 'in-progress',
  [LifecycleState.EVALUATING]: 'in-evaluation',
  [LifecycleState.READY_FOR_REVIEW]: 'in-evaluation',
  [LifecycleState.CLOSING]: 'in-evaluation',
  [LifecycleState.DONE]: 'done',
  [LifecycleState.PAUSED]: 'paused',
});

// ---------------------------------------------------------------------------
// Workflow agent status → dashboard agent status mapping
// ---------------------------------------------------------------------------

const AGENT_STATUS_TO_DASHBOARD = Object.freeze({
  idle: 'implementing',
  running: 'implementing',
  waiting: 'waiting',
  ready: 'submitted',
  failed: 'error',
  lost: 'error',
  needs_attention: 'needs-attention',
});

// ---------------------------------------------------------------------------
// Synthetic context for pre-engine entities (inbox/backlog without snapshots)
// ---------------------------------------------------------------------------

const STAGE_TO_LIFECYCLE = Object.freeze({
  'inbox': 'inbox',
  'backlog': 'backlog',
  'in-progress': 'implementing',
  'in-evaluation': 'evaluating',
  'done': 'done',
  'paused': 'paused',
});

function createSyntheticContext(entityType, entityId, stage) {
  return {
    entityType,
    featureId: entityId,
    currentSpecState: STAGE_TO_LIFECYCLE[stage] || stage,
    lifecycle: STAGE_TO_LIFECYCLE[stage] || stage,
    mode: 'solo_branch',
    agents: {},
    winnerAgentId: null,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Snapshot → dashboard action mapping
// ---------------------------------------------------------------------------

function getFreshSnapshotActions(context) {
  if (!context) return [];
  const { deriveAvailableActions } = require('./workflow-core/actions');
  return deriveAvailableActions(context);
}

const SNAPSHOT_ACTION_DESCRIPTORS = Object.freeze({
  [ManualActionKind.OPEN_SESSION]: { action: 'open-session', reason: null, board: false },
  [ManualActionKind.FEATURE_START]: { action: 'feature-start', reason: 'Start implementing this feature', board: true },
  [ManualActionKind.FEATURE_PRIORITISE]: { action: 'feature-prioritise', reason: 'Move to backlog', board: true },
  [ManualActionKind.FEATURE_AUTONOMOUS_START]: { action: 'feature-autonomous-start', reason: 'Start this feature autonomously', board: true },
  [ManualActionKind.FEATURE_STOP]: { action: 'feature-stop', reason: null, board: false },
  [ManualActionKind.PAUSE_FEATURE]: { action: 'feature-pause', reason: 'Pause feature execution', board: true },
  [ManualActionKind.RESUME_FEATURE]: { action: 'feature-resume', reason: 'Resume paused feature', board: true },
  [ManualActionKind.FEATURE_REVIEW]: { action: 'feature-review', reason: 'Code review of implementation with a different agent', board: false },
  [ManualActionKind.FEATURE_REVIEW_CHECK]: { action: 'feature-review-check', reason: 'Check code review changes as the implementer', board: true },
  [ManualActionKind.FEATURE_SPEC_REVIEW]: { action: 'feature-spec-review', reason: 'Review the spec with a different agent', board: true },
  [ManualActionKind.FEATURE_SPEC_REVIEW_CHECK]: { action: 'feature-spec-review-check', reason: 'Review pending spec-review changes', board: true },
  [ManualActionKind.FEATURE_EVAL]: { action: 'feature-eval', reason: 'All agents submitted; compare implementations', board: true },
  [ManualActionKind.FEATURE_PUSH]: { action: 'feature-push', reason: 'Push feature branch to origin', board: false },
  [ManualActionKind.FEATURE_CLOSE]: { action: 'feature-close', reason: 'Close and merge implementation', board: true },
  [ManualActionKind.FEATURE_RESET]: { action: 'feature-reset', reason: 'Reset feature back to backlog (destructive)', board: true },
  [ManualActionKind.FEATURE_NUDGE]: { action: 'feature-nudge', reason: 'Send a message into a running agent session', board: false },
  [ManualActionKind.RESEARCH_START]: { action: 'research-start', reason: 'Start this research topic', board: true },
  [ManualActionKind.RESEARCH_PRIORITISE]: { action: 'research-prioritise', reason: 'Move to backlog', board: true },
  [ManualActionKind.RESEARCH_STOP]: { action: 'research-stop', reason: null, board: false },
  [ManualActionKind.PAUSE_RESEARCH]: { action: 'research-pause', reason: 'Pause research', board: true },
  [ManualActionKind.RESUME_RESEARCH]: { action: 'research-resume', reason: 'Resume paused research', board: true },
  [ManualActionKind.RESEARCH_REVIEW]: { action: 'research-review', reason: 'Review findings with a different agent', board: false },
  [ManualActionKind.RESEARCH_SPEC_REVIEW]: { action: 'research-spec-review', reason: 'Review the research spec with a different agent', board: true },
  [ManualActionKind.RESEARCH_SPEC_REVIEW_CHECK]: { action: 'research-spec-review-check', reason: 'Review pending spec-review changes', board: true },
  [ManualActionKind.RESEARCH_EVAL]: { action: 'research-eval', reason: 'Evaluate findings', board: true },
  [ManualActionKind.RESEARCH_CLOSE]: { action: 'research-close', reason: 'Close research and move to done', board: true },
  [ManualActionKind.RESEARCH_RESET]: { action: 'research-reset', reason: 'Reset research back to backlog (destructive)', board: true },
  [ManualActionKind.FORCE_AGENT_READY]: { action: 'force-agent-ready', reason: null, board: false },
  [ManualActionKind.DROP_AGENT]: { action: 'drop-agent', reason: null, board: false },
  [ManualActionKind.SELECT_WINNER]: { action: 'select-winner', reason: null, board: true },
  // Infra actions
  [ManualActionKind.DEV_SERVER_POKE]: { action: 'dev-server-poke', reason: 'Start dev server preview', board: false },
  [ManualActionKind.MARK_SUBMITTED]: { action: 'mark-submitted', reason: 'Mark agent as submitted', board: false },
  [ManualActionKind.REOPEN_AGENT]: { action: 'reopen-agent', reason: 'Re-open agent session', board: false },
  [ManualActionKind.VIEW_WORK]: { action: 'view-work', reason: 'View agent work', board: false },
  [ManualActionKind.RECONCILE_SPEC_DRIFT]: { action: 'reconcile-spec-drift', reason: 'Reconcile spec folder drift with workflow state', board: false },
  [ManualActionKind.VIEW_FINDINGS]: { action: 'view-findings', reason: null, board: false },
  [ManualActionKind.VIEW_EVAL]: { action: 'view-eval', reason: 'View evaluation results', board: false },
  [ManualActionKind.OPEN_EVAL_SESSION]: { action: 'open-eval-session', reason: 'Open evaluation session', board: false },
});

const TRANSITION_ACTIONS = new Set([
  'feature-start',
  'feature-prioritise',
  'feature-pause',
  'feature-resume',
  'feature-eval',
  'feature-close',
  'research-start',
  'research-prioritise',
  'research-pause',
  'research-resume',
  'research-eval',
  'research-close',
]);

// Maps transition action → target kanban stage, used to populate `to` on validActions items
// so the frontend drag-drop system can compute valid drop targets.
const TRANSITION_ACTION_TO_STAGE = new Map([
  ['feature-prioritise', 'backlog'],
  ['feature-start', 'in-progress'],
  ['feature-eval', 'in-evaluation'],
  ['feature-close', 'done'],
  ['feature-pause', 'paused'],
  ['feature-resume', 'backlog'],
  ['research-prioritise', 'backlog'],
  ['research-start', 'in-progress'],
  ['research-eval', 'in-evaluation'],
  ['research-close', 'done'],
  ['research-pause', 'paused'],
  ['research-resume', 'backlog'],
]);

const HIGH_PRIORITY_ACTION_KINDS = new Set([
  ManualActionKind.FEATURE_START,
  ManualActionKind.FEATURE_PRIORITISE,
  ManualActionKind.FEATURE_EVAL,
  ManualActionKind.FEATURE_CLOSE,
  ManualActionKind.SELECT_WINNER,
  ManualActionKind.RESEARCH_PRIORITISE,
  ManualActionKind.RESEARCH_EVAL,
  ManualActionKind.RESEARCH_CLOSE,
]);

function getSnapshotActionDescriptor(entityType, action) {
  if (action.kind === ManualActionKind.RESTART_AGENT) {
    return {
      action: entityType === 'research' ? 'research-open' : 'feature-open',
      reason: `Restart agent ${action.agentId || ''}`,
      board: true,
    };
  }

  const descriptor = SNAPSHOT_ACTION_DESCRIPTORS[action.kind];
  if (!descriptor) return null;

  if (descriptor.reason !== null) return descriptor;
  if (action.kind === ManualActionKind.OPEN_SESSION) {
    return { ...descriptor, reason: `Open session for agent ${action.agentId || ''}` };
  }
  if (action.kind === ManualActionKind.FORCE_AGENT_READY) {
    return { ...descriptor, reason: `Force agent ${action.agentId || ''} to ready state` };
  }
  if (action.kind === ManualActionKind.DROP_AGENT) {
    return { ...descriptor, reason: `Drop agent ${action.agentId || ''}` };
  }
  if (action.kind === ManualActionKind.FEATURE_STOP || action.kind === ManualActionKind.RESEARCH_STOP) {
    return { ...descriptor, reason: `Stop agent ${action.agentId || ''}` };
  }
  if (action.kind === ManualActionKind.SELECT_WINNER) {
    return { ...descriptor, reason: `Select ${action.agentId || ''} as winner` };
  }
  if (action.kind === ManualActionKind.VIEW_FINDINGS) {
    return { ...descriptor, reason: `View ${action.agentId || ''} findings` };
  }
  return descriptor;
}

/**
 * Map a workflow-core availableAction to a dashboard action object.
 * @param {string} entityType - 'feature' or 'research'
 * @param {string} entityId
 * @param {object} action - { kind, label, eventType, recommendedOrder, agentId }
 * @returns {{ command: string, label: string, reason: string, action: string, agentId: string|null }|null}
 */
function mapSnapshotActionToDashboard(entityType, entityId, action) {
  const entry = getSnapshotActionDescriptor(entityType, action);
  if (entry === null) return null;

  // Classify: per-agent actions vs feature-level actions
  const isTransition = TRANSITION_ACTIONS.has(entry.action);
  // High priority for eval (all submitted) and close (winner picked)
  const isHighPriority = HIGH_PRIORITY_ACTION_KINDS.has(action.kind);

  // Infra/view actions don't need CLI commands
  const isInfraOrView = action.category === ActionCategory.INFRA
    || action.category === ActionCategory.VIEW
    || action.category === 'infra'
    || action.category === 'view';
  const command = isInfraOrView
    ? null
    : formatDashboardActionCommand(entry.action, entityId, {
        entityType,
        agentId: action.agentId || null,
      });

  return {
    command,
    label: action.label,
    reason: entry.reason,
    action: entry.action,
    kind: action.kind,
    agentId: action.agentId || null,
    mode: action.mode || null,
    category: action.category || (isTransition ? 'lifecycle' : 'agent-control'),
    type: isTransition ? 'transition' : 'action',
    to: isTransition ? (TRANSITION_ACTION_TO_STAGE.get(entry.action) || null) : null,
    priority: isHighPriority ? 'high' : 'normal',
    requiresInput: action.requiresInput || null,
    scope: action.scope || null,
    metadata: action.metadata || null,
    clientOnly: action.clientOnly || false,
  };
}

/**
 * Map a workflow-core availableAction to a board command string.
 * @param {string} entityType
 * @param {string} entityId
 * @param {object} action
 * @returns {string|null}
 */
function mapSnapshotActionToBoard(entityType, entityId, action) {
  const descriptor = getSnapshotActionDescriptor(entityType, action);
  if (!descriptor || !descriptor.board) return null;

  return formatBoardActionCommand(descriptor.action, entityId, {
    entityType,
    agentId: action.agentId || null,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a workflow snapshot for a feature, if one exists.
 * Pure read — no side effects, no locking.
 *
 * @param {string} repoPath - Absolute path to the repository root
 * @param {string} featureId - Feature ID (e.g. '139')
 * @returns {Promise<object|null>} The snapshot object, or null if not present
 */
async function readFeatureSnapshot(repoPath, featureId) {
  return readWorkflowSnapshot(repoPath, 'feature', featureId);
}

/**
 * Synchronous version for use in the dashboard's sync polling loop.
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {object|null}
 */
function readFeatureSnapshotSync(repoPath, featureId) {
  return readWorkflowSnapshotSync(repoPath, 'feature', featureId);
}

async function readWorkflowSnapshot(repoPath, entityType, entityId) {
  const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);
  try {
    const content = await fs.readFile(snapshotPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

// Mtime-based cache: avoids re-reading snapshot files that haven't changed.
// The dashboard polls every 10s across potentially hundreds of features — without
// caching, each poll does O(features) readFileSync calls even when nothing changed.
// Key: snapshotPath, Value: { mtime: number, data: object|null }
const _snapshotCache = new Map();

function readWorkflowSnapshotSync(repoPath, entityType, entityId) {
  const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);
  try {
    const stat = fsSync.statSync(snapshotPath);
    const mtime = stat.mtimeMs;
    const cached = _snapshotCache.get(snapshotPath);
    if (cached && cached.mtime === mtime) return cached.data;
    const content = fsSync.readFileSync(snapshotPath, 'utf8');
    const data = JSON.parse(content);
    _snapshotCache.set(snapshotPath, { mtime, data });
    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Map a workflow snapshot's lifecycle to a dashboard stage string.
 * @param {object} snapshot
 * @returns {string|null} Dashboard stage, or null if unmapped
 */
function snapshotToStage(snapshot) {
  if (!snapshot || !snapshot.lifecycle) return null;
  return LIFECYCLE_TO_STAGE[snapshot.lifecycle] || null;
}

/**
 * Map a workflow snapshot's agent statuses to dashboard-compatible status strings.
 * @param {object} snapshot
 * @returns {Object<string, string>} Map of agentId → dashboard status
 */
function snapshotAgentStatuses(snapshot) {
  if (!snapshot || !snapshot.agents) return {};
  const result = {};
  for (const [agentId, agent] of Object.entries(snapshot.agents)) {
    result[agentId] = AGENT_STATUS_TO_DASHBOARD[agent.status] || 'implementing';
  }
  return result;
}

/**
 * Get dashboard-formatted next actions from a workflow snapshot.
 * @param {string} entityType
 * @param {string} entityId
 * @param {object} snapshot
 * @returns {{ nextAction: {command: string, reason: string}|null, nextActions: object[], validActions: string[] }}
 */
function snapshotToDashboardActions(entityType, entityId, snapshot, stage) {
  const context = snapshot || (stage ? createSyntheticContext(entityType, entityId, stage) : null);
  if (!context) {
    return { nextAction: null, nextActions: [], validActions: [] };
  }

  const nextActions = getFreshSnapshotActions(context)
    .map(a => mapSnapshotActionToDashboard(entityType, entityId, a))
    .filter(Boolean);
  const nextAction = nextActions.length > 0
    ? { command: nextActions[0].command, reason: nextActions[0].reason }
    : null;

  return { nextAction, nextActions, validActions: nextActions };
}

/**
 * Get the first board command from a workflow snapshot's available actions.
 * @param {string} entityType
 * @param {string} entityId
 * @param {object} snapshot
 * @returns {string|null}
 */
function snapshotToBoardCommand(entityType, entityId, snapshot) {
  if (!snapshot) return null;

  // Prefer freshly-derived actions (includes session actions like open-session)
  const actions = getFreshSnapshotActions(snapshot);
  for (const action of actions) {
    const cmd = mapSnapshotActionToBoard(entityType, entityId, action);
    if (cmd) return cmd;
  }
  return null;
}

/**
 * Read the engine event log synchronously for a feature.
 * Returns signal events formatted for dashboard display, or empty array.
 *
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {object[]} Array of { type, agentId, at } event objects
 */
function readFeatureEventsSync(repoPath, featureId) {
  return readWorkflowEventsSync(repoPath, 'feature', featureId);
}

function readWorkflowEventsSync(repoPath, entityType, entityId) {
  const eventsPath = getEventsPathForEntity(repoPath, entityType, entityId);
  try {
    const content = fsSync.readFileSync(eventsPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

/**
 * Filter engine events to agent signal events only (for Events tab display).
 * @param {object[]} events - Full event log
 * @returns {object[]} Signal events only
 */
function filterAgentSignalEvents(events) {
  // Show lifecycle + signal events, hide internal plumbing (effects, heartbeats)
  const hideTypes = new Set([
    'effect.requested',
    'effect.claimed',
    'effect.succeeded',
    'effect.failed',
    'effect.claim_expired',
    'effect.reclaimed',
    'signal.heartbeat',
  ]);
  return events.filter(e => !hideTypes.has(e.type));
}

module.exports = {
  // Core reads
  readWorkflowSnapshot,
  readWorkflowSnapshotSync,
  readWorkflowEventsSync,
  readFeatureSnapshot,
  readFeatureSnapshotSync,
  readFeatureEventsSync,

  // Mapping functions
  snapshotToStage,
  snapshotAgentStatuses,
  snapshotToDashboardActions,
  snapshotToBoardCommand,
  mapSnapshotActionToDashboard,
  mapSnapshotActionToBoard,
  filterAgentSignalEvents,

  // Synthetic context for pre-engine entities
  createSyntheticContext,

  // Constants (for testing)
  LIFECYCLE_TO_STAGE,
  AGENT_STATUS_TO_DASHBOARD,
};
