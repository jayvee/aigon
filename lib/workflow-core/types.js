'use strict';

/**
 * Workflow-core type definitions and constants.
 *
 * Ported from aigon-next/src/workflow/feature-types.ts.
 * Since Aigon is plain JS (no TypeScript), these are exported as
 * frozen enum-like objects for runtime use and JSDoc reference.
 */

/** @enum {string} */
const FeatureMode = Object.freeze({
  SOLO_BRANCH: 'solo_branch',
  SOLO_WORKTREE: 'solo_worktree',
  FLEET: 'fleet',
});

/** @enum {string} */
const LifecycleState = Object.freeze({
  BACKLOG: 'backlog',
  IMPLEMENTING: 'implementing',
  READY_FOR_REVIEW: 'ready_for_review',
  EVALUATING: 'evaluating',
  CLOSING: 'closing',
  DONE: 'done',
  PAUSED: 'paused',
});

/** @enum {string} */
const AgentStatus = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  WAITING: 'waiting',
  READY: 'ready',
  FAILED: 'failed',
  LOST: 'lost',
  NEEDS_ATTENTION: 'needs_attention',
});

/** @enum {string} */
const ManualActionKind = Object.freeze({
  PAUSE_FEATURE: 'pause-feature',
  RESUME_FEATURE: 'resume-feature',
  FEATURE_EVAL: 'feature-eval',
  FEATURE_CLOSE: 'feature-close',
  RESTART_AGENT: 'restart-agent',
  FORCE_AGENT_READY: 'force-agent-ready',
  DROP_AGENT: 'drop-agent',
  SELECT_WINNER: 'select-winner',
});

/** @enum {string} */
const WorkflowEffectStatus = Object.freeze({
  REQUESTED: 'requested',
  CLAIMED: 'claimed',
  RECLAIMABLE: 'reclaimable',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
});

/** @enum {string} */
const EffectType = Object.freeze({
  ENSURE_FEATURE_LAYOUT: 'ensure_feature_layout',
  MOVE_SPEC: 'move_spec',
  WRITE_EVAL_STUB: 'write_eval_stub',
  WRITE_CLOSE_NOTE: 'write_close_note',
  ENSURE_AGENT_SESSION: 'ensure_agent_session',
});

// ---------------------------------------------------------------------------
// Factory helpers — create canonical object shapes
// ---------------------------------------------------------------------------

/**
 * @param {string} id
 * @param {string} status
 * @param {string|null} lastHeartbeatAt
 * @returns {{ id: string, status: string, lastHeartbeatAt: string|null }}
 */
function createAgentState(id, status = AgentStatus.IDLE, lastHeartbeatAt = null) {
  return { id, status, lastHeartbeatAt };
}

/**
 * @param {object} effect - EffectRequest shape
 * @returns {object} WorkflowEffect with initial status fields
 */
function createWorkflowEffect(effect) {
  return {
    ...effect,
    status: WorkflowEffectStatus.REQUESTED,
    claimedAt: null,
    claimExpiredAt: null,
    reclaimCount: 0,
    lastError: null,
  };
}

module.exports = {
  FeatureMode,
  LifecycleState,
  AgentStatus,
  ManualActionKind,
  WorkflowEffectStatus,
  EffectType,
  createAgentState,
  createWorkflowEffect,
};
