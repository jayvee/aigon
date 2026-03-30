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
const { LifecycleState, ManualActionKind } = require('./workflow-core/types');
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
  [LifecycleState.REVIEWING]: 'in-review',
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
// Snapshot → dashboard action mapping
// ---------------------------------------------------------------------------

function getFreshSnapshotActions(snapshot) {
  if (!snapshot) return [];
  const { deriveAvailableActions } = require('./workflow-core/actions');
  return deriveAvailableActions(snapshot);
}

const SNAPSHOT_ACTION_DESCRIPTORS = Object.freeze({
  [ManualActionKind.PAUSE_FEATURE]: { action: 'feature-pause', reason: 'Pause feature execution', board: true },
  [ManualActionKind.RESUME_FEATURE]: { action: 'feature-resume', reason: 'Resume paused feature', board: true },
  [ManualActionKind.FEATURE_REVIEW]: { action: 'feature-review', reason: 'Review implementation with a different agent', board: false },
  [ManualActionKind.FEATURE_EVAL]: { action: 'feature-eval', reason: 'All agents submitted; compare implementations', board: true },
  [ManualActionKind.FEATURE_CLOSE]: { action: 'feature-close', reason: 'Close and merge implementation', board: true },
  [ManualActionKind.RESEARCH_START]: { action: 'research-start', reason: 'Start this research topic', board: true },
  [ManualActionKind.PAUSE_RESEARCH]: { action: 'research-pause', reason: 'Pause research', board: true },
  [ManualActionKind.RESUME_RESEARCH]: { action: 'research-resume', reason: 'Resume paused research', board: true },
  [ManualActionKind.RESEARCH_EVAL]: { action: 'research-eval', reason: 'Evaluate findings', board: true },
  [ManualActionKind.RESEARCH_CLOSE]: { action: 'research-close', reason: 'Close research and move to done', board: true },
  [ManualActionKind.FORCE_AGENT_READY]: { action: 'force-agent-ready', reason: null, board: false },
  [ManualActionKind.DROP_AGENT]: { action: 'drop-agent', reason: null, board: false },
  [ManualActionKind.SELECT_WINNER]: { action: 'feature-close', reason: null, board: true },
});

const TRANSITION_ACTIONS = new Set([
  'feature-pause',
  'feature-resume',
  'feature-eval',
  'feature-close',
  'research-start',
  'research-pause',
  'research-resume',
  'research-eval',
  'research-close',
]);

const HIGH_PRIORITY_ACTION_KINDS = new Set([
  ManualActionKind.FEATURE_EVAL,
  ManualActionKind.FEATURE_CLOSE,
  ManualActionKind.SELECT_WINNER,
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
  if (action.kind === ManualActionKind.FORCE_AGENT_READY) {
    return { ...descriptor, reason: `Force agent ${action.agentId || ''} to ready state` };
  }
  if (action.kind === ManualActionKind.DROP_AGENT) {
    return { ...descriptor, reason: `Drop agent ${action.agentId || ''}` };
  }
  if (action.kind === ManualActionKind.SELECT_WINNER) {
    return { ...descriptor, reason: `Select ${action.agentId || ''} as winner` };
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

  return {
    command: formatDashboardActionCommand(entry.action, entityId, {
      entityType,
      agentId: action.agentId || null,
    }),
    label: action.label,
    reason: entry.reason,
    action: entry.action,
    agentId: action.agentId || null,
    type: isTransition ? 'transition' : 'action',
    priority: isHighPriority ? 'high' : 'normal',
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

function readWorkflowSnapshotSync(repoPath, entityType, entityId) {
  const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);
  try {
    const content = fsSync.readFileSync(snapshotPath, 'utf8');
    return JSON.parse(content);
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
function snapshotToDashboardActions(entityType, entityId, snapshot) {
  if (!snapshot) {
    return { nextAction: null, nextActions: [], validActions: [] };
  }

  const nextActions = getFreshSnapshotActions(snapshot)
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
  if (!snapshot || !Array.isArray(snapshot.availableActions)) return null;

  for (const action of snapshot.availableActions) {
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
  const signalTypes = new Set([
    'signal.agent_started',
    'signal.agent_waiting',
    'signal.agent_ready',
    'signal.agent_failed',
    'signal.session_lost',
    'signal.heartbeat',
    'signal.heartbeat_expired',
    'agent.restarted',
    'agent.needs_attention',
    'agent.force_ready',
    'agent.dropped',
  ]);
  return events.filter(e => signalTypes.has(e.type));
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

  // Constants (for testing)
  LIFECYCLE_TO_STAGE,
  AGENT_STATUS_TO_DASHBOARD,
};
