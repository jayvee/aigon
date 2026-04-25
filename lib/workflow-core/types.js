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
  INBOX: 'inbox',
  BACKLOG: 'backlog',
  SPEC_REVIEW_IN_PROGRESS: 'spec_review_in_progress',
  SPEC_REVIEW_COMPLETE: 'spec_review_complete',
  SPEC_REVISION_IN_PROGRESS: 'spec_revision_in_progress',
  SPEC_REVISION_COMPLETE: 'spec_revision_complete',
  IMPLEMENTING: 'implementing',
  SUBMITTED: 'submitted',
  CODE_REVIEW_IN_PROGRESS: 'code_review_in_progress',
  CODE_REVIEW_COMPLETE: 'code_review_complete',
  CODE_REVISION_IN_PROGRESS: 'code_revision_in_progress',
  CODE_REVISION_COMPLETE: 'code_revision_complete',
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
  // Workflow (lifecycle) actions
  FEATURE_START: 'feature-start',
  FEATURE_PRIORITISE: 'feature-prioritise',
  FEATURE_AUTONOMOUS_START: 'feature-autonomous-start',
  FEATURE_STOP: 'feature-stop',
  PAUSE_FEATURE: 'pause-feature',
  RESUME_FEATURE: 'resume-feature',
  FEATURE_CODE_REVIEW: 'feature-code-review',
  FEATURE_CODE_REVISE: 'feature-code-revise',
  FEATURE_CODE_REVIEW_CYCLE: 'feature-code-review-cycle',
  FEATURE_PROCEED_AFTER_REVIEW: 'feature-proceed-after-review',
  FEATURE_SPEC_REVIEW: 'feature-spec-review',
  FEATURE_SPEC_REVISE: 'feature-spec-revise',
  FEATURE_CANCEL_SPEC_REVIEW: 'feature-cancel-spec-review',
  FEATURE_CANCEL_SPEC_REVISION: 'feature-cancel-spec-revision',
  FEATURE_EVAL: 'feature-eval',
  FEATURE_PUSH: 'feature-push',
  FEATURE_CLOSE: 'feature-close',
  FEATURE_RESOLVE_AND_CLOSE: 'feature-resolve-and-close',
  FEATURE_RESET: 'feature-reset',
  FEATURE_DELETE: 'feature-delete',
  FEATURE_NUDGE: 'feature-nudge',
  RESEARCH_START: 'research-start',
  RESEARCH_PRIORITISE: 'research-prioritise',
  RESEARCH_STOP: 'research-stop',
  PAUSE_RESEARCH: 'research-pause',
  RESUME_RESEARCH: 'research-resume',
  RESEARCH_EVAL: 'research-eval',
  RESEARCH_REVIEW: 'research-review',
  RESEARCH_CODE_REVIEW_CYCLE: 'research-code-review-cycle',
  RESEARCH_PROCEED_AFTER_REVIEW: 'research-proceed-after-review',
  RESEARCH_SPEC_REVIEW: 'research-spec-review',
  RESEARCH_SPEC_REVISE: 'research-spec-revise',
  RESEARCH_CANCEL_SPEC_REVIEW: 'research-cancel-spec-review',
  RESEARCH_CANCEL_SPEC_REVISION: 'research-cancel-spec-revision',
  RESEARCH_CLOSE: 'research-close',
  RESEARCH_RESET: 'research-reset',
  RESEARCH_DELETE: 'research-delete',
  RESTART_AGENT: 'restart-agent',
  SWITCH_AGENT: 'switch-agent',
  FORCE_AGENT_READY: 'force-agent-ready',
  DROP_AGENT: 'drop-agent',
  SELECT_WINNER: 'select-winner',
  OPEN_SESSION: 'open-session',
  // Infra actions (bypass XState, custom guards)
  DEV_SERVER_POKE: 'dev-server-poke',
  MARK_SUBMITTED: 'mark-submitted',
  REOPEN_AGENT: 'reopen-agent',
  VIEW_WORK: 'view-work',
  RECONCILE_SPEC_DRIFT: 'reconcile-spec-drift',
  VIEW_FINDINGS: 'view-findings',
  VIEW_EVAL: 'view-eval',
  OPEN_EVAL_SESSION: 'open-eval-session',
});

/** @enum {string} */
const ActionCategory = Object.freeze({
  LIFECYCLE: 'lifecycle',
  SESSION: 'session',
  AGENT_CONTROL: 'agent-control',
  SPEC_REVIEW: 'spec-review',
  INFRA: 'infra',
  VIEW: 'view',
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
  ActionCategory,
  WorkflowEffectStatus,
  EffectType,
  createAgentState,
  createWorkflowEffect,
};
