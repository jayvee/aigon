'use strict';

/**
 * Read adapter: maps workflow-core snapshots to dashboard/board data formats.
 *
 * All reads are side-effect free — reads snapshot.json directly, no locking.
 * Falls back to null when no workflow snapshot exists for a feature.
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { getSnapshotPath, getEventsPath } = require('./workflow-core/paths');
const { LifecycleState, ManualActionKind } = require('./workflow-core/types');

// ---------------------------------------------------------------------------
// Lifecycle → dashboard stage mapping
// ---------------------------------------------------------------------------

const LIFECYCLE_TO_STAGE = Object.freeze({
  [LifecycleState.BACKLOG]: 'backlog',
  [LifecycleState.IMPLEMENTING]: 'in-progress',
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
});

// ---------------------------------------------------------------------------
// Snapshot → dashboard action mapping
// ---------------------------------------------------------------------------

function padId(id) {
  return String(id || '').padStart(2, '0');
}

/**
 * Map a workflow-core availableAction to a dashboard action object.
 * @param {string} entityType - 'feature' or 'research'
 * @param {string} entityId
 * @param {object} action - { kind, label, eventType, recommendedOrder, agentId }
 * @returns {{ command: string, label: string, reason: string, action: string, agentId: string|null }|null}
 */
function mapSnapshotActionToDashboard(entityType, entityId, action) {
  const id = padId(entityId);
  const agentSuffix = action.agentId ? ` ${action.agentId}` : '';

  const mapping = {
    [ManualActionKind.PAUSE_FEATURE]: {
      command: `aigon feature-pause ${id}`,
      action: 'feature-pause',
      reason: 'Pause feature execution',
    },
    [ManualActionKind.RESUME_FEATURE]: {
      command: `aigon feature-resume ${id}`,
      action: 'feature-resume',
      reason: 'Resume paused feature',
    },
    [ManualActionKind.FEATURE_EVAL]: {
      command: `/afe ${id}`,
      action: 'feature-eval',
      reason: 'All agents submitted; compare implementations',
    },
    [ManualActionKind.FEATURE_CLOSE]: {
      command: `aigon feature-close ${id}${agentSuffix}`,
      action: 'feature-close',
      reason: 'Close and merge implementation',
    },
    [ManualActionKind.RESTART_AGENT]: {
      command: `aigon feature-open ${id}${agentSuffix}`,
      action: 'feature-open',
      reason: `Restart agent ${action.agentId || ''}`,
    },
    [ManualActionKind.FORCE_AGENT_READY]: {
      command: `aigon agent-status submitted${agentSuffix ? '' : ''}`, // force-ready is an internal action
      action: 'force-agent-ready',
      reason: `Force agent ${action.agentId || ''} to ready state`,
    },
    [ManualActionKind.DROP_AGENT]: {
      command: `aigon feature-stop ${id}${agentSuffix}`,
      action: 'feature-stop',
      reason: `Drop agent ${action.agentId || ''}`,
    },
    [ManualActionKind.SELECT_WINNER]: {
      command: `aigon feature-close ${id}${agentSuffix}`,
      action: 'feature-close',
      reason: `Select ${action.agentId || ''} as winner`,
    },
  };

  const entry = mapping[action.kind];
  if (!entry) return null;

  return {
    command: entry.command,
    label: action.label,
    reason: entry.reason,
    action: entry.action,
    agentId: action.agentId || null,
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
  const id = padId(entityId);
  const isSolo = !action.agentId;

  const mapping = {
    [ManualActionKind.PAUSE_FEATURE]: `aigon feature-pause ${id}`,
    [ManualActionKind.RESUME_FEATURE]: `aigon feature-resume ${id}`,
    [ManualActionKind.FEATURE_EVAL]: `aigon feature-eval ${id}`,
    [ManualActionKind.FEATURE_CLOSE]: isSolo ? `aigon feature-close ${id}` : `aigon feature-close ${id} ${action.agentId}`,
    [ManualActionKind.RESTART_AGENT]: isSolo ? `aigon feature-do ${id}` : `aigon feature-open ${id} ${action.agentId}`,
    [ManualActionKind.FORCE_AGENT_READY]: null, // Not a board action
    [ManualActionKind.DROP_AGENT]: null, // Not a board action
    [ManualActionKind.SELECT_WINNER]: `aigon feature-close ${id} ${action.agentId}`,
  };

  return mapping[action.kind] || null;
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
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  try {
    const content = await fs.readFile(snapshotPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    // Corrupted snapshot — treat as absent, don't crash the dashboard
    return null;
  }
}

/**
 * Synchronous version for use in the dashboard's sync polling loop.
 * @param {string} repoPath
 * @param {string} featureId
 * @returns {object|null}
 */
function readFeatureSnapshotSync(repoPath, featureId) {
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  try {
    const content = require('fs').readFileSync(snapshotPath, 'utf8');
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
  if (!snapshot || !Array.isArray(snapshot.availableActions)) {
    return { nextAction: null, nextActions: [], validActions: [] };
  }

  const nextActions = snapshot.availableActions
    .map(a => mapSnapshotActionToDashboard(entityType, entityId, a))
    .filter(Boolean);

  const validActions = snapshot.availableActions.map(a => a.kind);

  const nextAction = nextActions.length > 0
    ? { command: nextActions[0].command, reason: nextActions[0].reason }
    : null;

  return { nextAction, nextActions, validActions };
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
  const eventsPath = getEventsPath(repoPath, featureId);
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
  ]);
  return events.filter(e => signalTypes.has(e.type));
}

module.exports = {
  // Core reads
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
