/* dashboard-esm-processed */

// F679 contract card renderer — autonomous run plan and feature-set plan.
//
// The controller renders above its stages: it is the higher-level surface.
// Stage rows use one fixed grid (marker · stage · agent · status · Peek) so
// columns align across Implement, Review, Revise, and Close. Worker sessions
// render inside the stage that owns them via contract `stage.sessionIds`.

import { agentDisplay, escHtml, peekButtonHtml, statusLabel } from './html.js';

function stageMarker(status) {
  if (status === 'complete') return '✓';
  if (status === 'running') return '●';
  if (status === 'failed') return '!';
  return '○';
}

const STAGE_STATUS_LABELS = {
  complete: 'Complete',
  running: 'Running',
  failed: 'Failed',
  stopped: 'Stopped',
  'quota-paused': 'Quota paused',
  waiting: 'Waiting',
};

function stageStatusLabel(status) {
  return STAGE_STATUS_LABELS[String(status || 'waiting')]
    || String(status || 'waiting').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
}

function sessionById(contract, sessionId) {
  if (!sessionId) return null;
  return (contract.sessions || []).find(session => session.sessionId === sessionId) || null;
}

function controllerStatusLabel(controller) {
  const status = String(controller && controller.status || 'running');
  if (status === 'stopped') return 'Stopped';
  if (status === 'failed') return 'Failed';
  if (status === 'paused-on-failure') return 'Paused after failure';
  if (status === 'paused-on-quota') return 'Paused for quota';
  return 'Running';
}

export function runPlanHtml(contract, options = {}) {
  const plan = contract && contract.plan;
  if (!plan || !Array.isArray(plan.stages) || plan.stages.length === 0) return '';
  const controller = plan.controller || {};
  const controllerStatus = String(controller.status || 'running');
  const controllerPeek = peekButtonHtml(sessionById(contract, plan.controllerSessionId), options);
  const stages = plan.stages.map((stage) => {
    const status = String(stage.status || 'waiting');
    const agents = (stage.agents || []).map(agent => agentDisplay(agent.id)).join(' + ');
    const stageSession = sessionById(contract, stage.sessionIds && stage.sessionIds[0]);
    return '<div class="ccard-stage is-' + escHtml(status) + '" role="listitem">'
      + '<span class="ccard-stage-marker" aria-hidden="true">' + stageMarker(status) + '</span>'
      + '<span class="ccard-stage-name">' + escHtml(stage.label || stage.type || 'Stage') + '</span>'
      + '<span class="ccard-stage-agent">' + escHtml(agents) + '</span>'
      + '<span class="ccard-stage-status">' + escHtml(stageStatusLabel(status)) + '</span>'
      + '<span class="ccard-stage-tools">' + peekButtonHtml(stageSession, options) + '</span>'
      + '</div>';
  }).join('');
  return '<div class="ccard-run">'
    + '<div class="ccard-run-head">'
    + '<strong>Autonomous run</strong>'
    + '<span class="ccard-run-controller"><span class="ccard-run-status is-' + escHtml(controllerStatus) + '">'
    + escHtml(controllerStatusLabel(controller)) + '</span>' + controllerPeek + '</span>'
    + '</div>'
    + '<div class="ccard-stages" role="list" aria-label="Autonomous run stages">' + stages + '</div>'
    + '</div>';
}

function memberMarkerStatus(status) {
  if (status === 'inbox' || status === 'backlog' || status === 'waiting') return 'waiting';
  return status;
}

function memberNameHtml(member) {
  const id = member.id && member.id !== 'new' ? String(member.id) : '';
  const label = String(member.label || member.name || '');
  const slugFromLabel = label.replace(/\s+/g, '-').toLowerCase();
  const idIsRedundantSlug = id && (id === slugFromLabel || id.replace(/-/g, ' ') === label);
  if (idIsRedundantSlug) {
    return '<span class="ccard-member-name">' + escHtml(label || id) + '</span>';
  }
  return '<span class="ccard-member-name">'
    + (id ? '<b>#' + escHtml(id) + '</b> ' : '')
    + escHtml(label) + '</span>';
}

/**
 * Set plan: member progress plus the embedded current-member contract. The
 * caller supplies `renderEmbedded(contract)` so the current member renders
 * with the full feature card primitives (activity + run plan) rather than a
 * flattened generic row.
 */
export function setPlanHtml(contract, options = {}) {
  const plan = contract && contract.plan;
  if (!plan || !Array.isArray(plan.members)) return '';
  const progress = plan.progress || { complete: 0, total: plan.members.length };
  const percent = progress.total ? Math.round((Number(progress.complete) / Number(progress.total)) * 100) : 0;
  const members = options.suppressMemberList ? '' : plan.members.map((member) => {
    const status = String(member.status || 'waiting');
    return '<div class="ccard-member is-' + escHtml(status) + (member.isCurrent ? ' is-current' : '') + '" role="listitem">'
      + '<span class="ccard-stage-marker" aria-hidden="true">' + stageMarker(memberMarkerStatus(status)) + '</span>'
      + '<span class="ccard-member-copy">'
      + memberNameHtml(member)
      + '<span class="ccard-member-status">' + escHtml(statusLabel(status)) + '</span>'
      + '</span>'
      + '</div>';
  }).join('');
  const current = plan.currentFeatureContract;
  const embedded = current && typeof options.renderEmbedded === 'function'
    ? '<div class="ccard-set-current">'
      + '<div class="ccard-set-current-head"><span>Current feature</span>'
      + '<strong>' + escHtml(current.entity.displayKey) + ' ' + escHtml(current.entity.title || current.entity.name) + '</strong></div>'
      + options.renderEmbedded(current)
      + '</div>'
    : '';
  return '<div class="ccard-set-plan">'
    + '<div class="ccard-set-progress"><span>' + escHtml(progress.complete) + ' of ' + escHtml(progress.total) + ' complete</span></div>'
    + '<div class="ccard-set-track" role="img" aria-label="' + escHtml(progress.complete) + ' of ' + escHtml(progress.total) + ' member features complete"><span style="width:' + percent + '%"></span></div>'
    + (members ? '<div class="ccard-members" role="list" aria-label="Set member features">' + members + '</div>' : '')
    + embedded
    + '</div>';
}

const CYCLE_PILL_CLASSES = {
  running: ' is-active',
  needed: ' is-paused',
  'feedback-waiting': ' is-paused',
};

function cyclePillHtml(kind, side, contract, options) {
  if (!side) return '';
  const status = String(side.status || 'inactive');
  const label = side.label || (kind + ': ' + statusLabel(status));
  // Peek lives inside the labeled pill so inspection is always attributed to
  // the review/revision it belongs to — never a bare eye button.
  const session = side.sessionId ? sessionById(contract, side.sessionId) : null;
  const peek = side.inspectable ? peekButtonHtml(session || {
    inspectable: true,
    sessionId: side.sessionId,
    label: kind,
    inspection: side.inspection,
  }, options) : '';
  return '<span class="ccard-pill' + (CYCLE_PILL_CLASSES[status] || ' is-inactive') + '">'
    + '<span class="ccard-pill-label">' + escHtml(label) + '</span>' + peek + '</span>';
}

/**
 * Set status pills: spec review, spec revision, conductor. Status comes from
 * contract `state.specCycle` facts — never from tmux liveness. The revision
 * pill renders only once revision is a live concern, mirroring the approved
 * gallery design.
 */
export function setCyclePillsHtml(contract, options = {}) {
  const specCycle = contract && contract.state && contract.state.specCycle;
  const controller = contract && contract.plan && contract.plan.controller;
  const parts = [];
  if (specCycle) {
    parts.push(cyclePillHtml('Spec review', specCycle.review, contract, options));
    const revision = specCycle.revision;
    if (revision && revision.status && revision.status !== 'inactive') {
      parts.push(cyclePillHtml('Spec revision', revision, contract, options));
    }
  }
  const controllerStatus = String(controller && controller.status || '');
  const conductorActive = Boolean(controller && (controller.running || controllerStatus === 'running'));
  const conductorPaused = controllerStatus === 'paused-on-failure' || controllerStatus === 'paused-on-quota';
  const conductorSession = sessionById(contract, (contract.plan && contract.plan.controllerSessionId)
    || (controller && controller.sessionName) || null);
  parts.push('<span class="ccard-pill' + (conductorActive ? ' is-active' : (conductorPaused ? ' is-paused' : ' is-inactive')) + '">'
    + '<span class="ccard-pill-label">Conductor: ' + (conductorActive ? 'running' : (conductorPaused ? 'paused' : 'inactive')) + '</span>'
    + peekButtonHtml(conductorSession, options) + '</span>');
  const rendered = parts.filter(Boolean).join('');
  return rendered ? '<div class="ccard-pills">' + rendered + '</div>' : '';
}
