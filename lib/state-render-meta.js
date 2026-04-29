'use strict';

/**
 * Server-side rendering metadata for each currentSpecState.
 * Dashboard API attaches stateRenderMeta per feature row; frontend renders
 * badges and agent-status spans from this table — zero per-state branching.
 */
const STATE_RENDER_META = Object.freeze({
  inbox:                    { icon: '○', label: 'Inbox',               cls: 'status-idle' },
  backlog:                  { icon: '○', label: 'Backlog',             cls: 'status-idle' },
  spec_review_in_progress:  { icon: '●', label: 'Spec review',         cls: 'status-reviewing', badge: '📋 Spec review' },
  spec_review_complete:     { icon: '✓', label: 'Spec reviewed',       cls: 'status-review-done', badge: '📋 Spec reviewed' },
  spec_revision_in_progress:{ icon: '●', label: 'Revising spec',       cls: 'status-reviewing', badge: '📋 Revising spec' },
  spec_revision_complete:   { icon: '✓', label: 'Spec revised',        cls: 'status-review-done' },
  implementing:             { icon: '●', label: 'Implementing',         cls: 'status-running', badge: '🔨 Implementing' },
  submitted:                { icon: '✓', label: 'Submitted',           cls: 'status-submitted' },
  code_review_in_progress:  { icon: '●', label: 'Code review',         cls: 'status-reviewing', badge: '👀 Code review' },
  code_review_complete:     { icon: '✓', label: 'Code reviewed',       cls: 'status-review-done' },
  code_revision_in_progress:{ icon: '●', label: 'Addressing review',   cls: 'status-running', badge: '✍️ Addressing review' },
  code_revision_complete:   { icon: '✓', label: 'Review addressed',    cls: 'status-review-done' },
  ready_for_review:         { icon: '○', label: 'Ready for review',    cls: 'status-idle' },
  evaluating:               { icon: '●', label: 'Evaluating',          cls: 'status-running', badge: '⚖️ Evaluating' },
  closing:                  { icon: '●', label: 'Closing',             cls: 'status-running', badge: '🚀 Closing' },
  close_recovery_in_progress:{ icon: '●', label: 'Close recovery',     cls: 'status-reviewing', badge: '🛠 Close recovery' },
  done:                     { icon: '✓', label: 'Done',                cls: 'status-submitted' },
  paused:                   { icon: '○', label: 'Paused',              cls: 'status-idle' },
});

const DEFAULT_META = Object.freeze({ icon: '○', label: 'Unknown', cls: 'status-idle' });

/**
 * Returns the render meta for a given currentSpecState, or DEFAULT_META.
 * @param {string} state
 * @returns {{ icon: string, label: string, cls: string, badge?: string }}
 */
function getStateRenderMeta(state) {
  return STATE_RENDER_META[state] || DEFAULT_META;
}

module.exports = { STATE_RENDER_META, DEFAULT_META, getStateRenderMeta };
