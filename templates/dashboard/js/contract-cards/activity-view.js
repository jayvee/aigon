/* dashboard-esm-processed */

// F679 contract card renderer — agent and session activity rows.
//
// Renders contract.agents and contract.sessions. Sessions owned by an
// autonomous plan stage (`stageOwned`) belong to that stage row and are never
// repeated here — the plan is the higher-level surface. Every remaining
// inspectable session (running, completed, stopped, lost, failed) exposes Peek
// through the shared session boundary.

import { agentDisplay, escHtml, peekButtonHtml, statusDotClass, statusLabel } from './html.js';
import { actionButtonHtml } from './actions-view.js';

function agentSurfaceActions(contract, agentId) {
  const decisions = (contract.decisions && contract.decisions.actions) || [];
  const tools = contract.tools || [];
  return decisions.concat(tools).filter(action => action.agentId === agentId
    && action.interaction && action.interaction.surface === 'agent');
}

function rowHtml(dotStatus, name, note, tools) {
  return '<div class="ccard-row" role="listitem">'
    + '<span class="ccard-dot ' + statusDotClass(dotStatus) + '" aria-hidden="true"></span>'
    + '<span class="ccard-row-name">' + escHtml(name) + '</span>'
    + '<span class="ccard-row-note">' + escHtml(note) + '</span>'
    + '<span class="ccard-row-tools">' + tools + '</span>'
    + '</div>';
}

export function activityHtml(contract, options = {}) {
  const sessions = contract.sessions || [];
  const freeSessions = sessions.filter(session => !session.stageOwned
    && !(contract.plan && contract.plan.controllerSessionId === session.sessionId));
  const rendered = new Set();
  const rows = [];

  (contract.agents || []).forEach((agent) => {
    // An agent whose work renders inside a plan stage is not repeated as a
    // peer activity row — the stage row is its single home.
    const ownsStageSession = sessions.some(session => session.stageOwned && session.agentId === agent.id);
    if (contract.plan && ownsStageSession) return;
    const inspectable = freeSessions.find(session => session.inspectable && session.agentId === agent.id);
    if (inspectable) rendered.add(inspectable.sessionId);
    const actionsHtml = agentSurfaceActions(contract, agent.id)
      .map(action => actionButtonHtml(action, 'ccard-row-action'))
      .join('');
    rows.push(rowHtml(
      agent.status,
      agentDisplay(agent.id),
      statusLabel(agent.status),
      actionsHtml + (inspectable ? peekButtonHtml(inspectable, options) : ''),
    ));
  });

  freeSessions
    .filter(session => session.inspectable && !rendered.has(session.sessionId))
    .forEach((session) => {
      rows.push(rowHtml(
        session.sessionStatus || (session.running ? 'running' : 'complete'),
        agentDisplay(session.agentId),
        session.label || statusLabel(session.role),
        peekButtonHtml(session, options),
      ));
    });

  if (!rows.length) return '';
  return '<div class="ccard-rows" role="list">' + rows.join('') + '</div>';
}

export function blockersHtml(contract) {
  const blockers = contract.blockers || [];
  if (!blockers.length) return '';
  const text = blockers
    .map(blocker => blocker.label || blocker.detail || blocker.reason || (blocker.id ? 'Blocked by #' + blocker.id : blocker.kind))
    .filter(Boolean)
    .join(' · ');
  return '<div class="ccard-blockers" role="note">' + escHtml(text) + '</div>';
}
