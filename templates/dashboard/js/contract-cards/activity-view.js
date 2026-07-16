/* dashboard-esm-processed */

// F679 contract card renderer — agent and session activity rows.
//
// Renders contract.agents and contract.sessions. Sessions owned by an
// autonomous plan stage (`stageOwned`) belong to that stage row and are never
// repeated here — the plan is the higher-level surface. Every remaining
// inspectable session (running, completed, stopped, lost, failed) exposes Peek
// through the shared session boundary.
//
// Solo active cards fold state + agent + tools into one status bar (wireframe B1)
// so the dominant state line is not repeated in a cramped second row.

import { agentDisplay, escHtml, formatHeadlineAge, peekButtonHtml, statusDotClass, statusLabel } from './html.js';
import { agentSurfaceActions, overflowMenuHtml, soloOverflowActions } from './actions-view.js';

function freeSessions(contract) {
  const sessions = contract.sessions || [];
  return sessions.filter(session => !session.stageOwned
    && !(contract.plan && contract.plan.controllerSessionId === session.sessionId));
}

function inspectableForAgent(contract, agentId) {
  return freeSessions(contract).find(session => session.inspectable && session.agentId === agentId) || null;
}

/** Solo active card: one agent whose work belongs inline on the status bar. */
export function soloStatusBarAgent(contract) {
  const agents = contract.agents || [];
  if (agents.length !== 1) return null;
  if (contract.plan && Array.isArray(contract.plan.stages) && contract.plan.stages.length > 0) return null;
  const headline = contract.presentation && contract.presentation.headline;
  if (!headline || !(headline.verb || headline.label)) return null;
  const agent = agents[0];
  if (headline.owner && String(headline.owner).toLowerCase() !== String(agent.id).toLowerCase()) return null;
  return agent;
}

/** Peek stays visible; agent session controls (Open Terminal, Stop, …) tuck into ⋯. */
function agentRowToolsHtml(contract, agentId, options) {
  const inspectable = inspectableForAgent(contract, agentId);
  const agentActions = agentSurfaceActions(contract, agentId);
  const peek = inspectable ? peekButtonHtml(inspectable, options) : '';
  const overflow = overflowMenuHtml(agentActions);
  if (!peek && !overflow) return '';
  return peek + overflow;
}

function soloToolsHtml(contract, agent, options) {
  const inspectable = inspectableForAgent(contract, agent.id);
  const peek = inspectable ? peekButtonHtml(inspectable, options) : '';
  const overflow = overflowMenuHtml(soloOverflowActions(contract, options));
  return peek + overflow;
}

/**
 * Wireframe B1: one status row — state · agent · age on the left, session tools
 * on the right. Replaces the separate state line + redundant agent row.
 */
export function statusBarHtml(contract, options = {}) {
  const agent = soloStatusBarAgent(contract);
  if (!agent) return '';
  const headline = contract.presentation && contract.presentation.headline;
  const text = (headline && (headline.verb || headline.label))
    || (contract.state && contract.state.label) || '';
  if (!text) return '';
  const age = formatHeadlineAge(headline && headline.age);
  const tools = soloToolsHtml(contract, agent, options);
  const ageHtml = age
    ? '<span class="ccard-status-sep" aria-hidden="true">·</span><span class="ccard-status-age">' + escHtml(age) + '</span>'
    : '';
  return '<div class="ccard-status-bar">'
    + '<div class="ccard-status-main">'
    + '<span class="ccard-state-dot" aria-hidden="true"></span>'
    + '<span class="ccard-state-text">' + escHtml(text) + '</span>'
    + '<span class="ccard-status-sep" aria-hidden="true">·</span>'
    + '<span class="ccard-agent-chip">'
    + '<span class="ccard-dot ' + statusDotClass(agent.status) + '" aria-hidden="true"></span>'
    + '<span>' + escHtml(agentDisplay(agent.id)) + '</span>'
    + '</span>'
    + ageHtml
    + '</div>'
    + (tools ? '<div class="ccard-status-tools">' + tools + '</div>' : '')
    + '</div>';
}

function agentRowNote(agent, contract) {
  const note = statusLabel(agent.status);
  if (!note) return '';
  const lifecycle = String((contract.state && contract.state.lifecycle) || '').toLowerCase();
  const normalized = note.toLowerCase();
  if (lifecycle === 'implementing' && (normalized === 'implementing' || normalized === 'working' || normalized === 'implementation')) return '';
  if (lifecycle === 'researching' && normalized === 'researching') return '';
  return note;
}

function sessionRowNote(session, contract) {
  const note = session.label || statusLabel(session.role);
  if (!note) return '';
  const lifecycle = String((contract.state && contract.state.lifecycle) || '').toLowerCase();
  const normalized = note.toLowerCase();
  if (lifecycle === 'implementing' && (normalized === 'implementing' || normalized === 'working' || normalized === 'implementation')) return '';
  if (lifecycle === 'researching' && (normalized === 'researching' || normalized === 'research')) return '';
  return note;
}

function rowHtml(dotStatus, name, note, tools) {
  const noteHtml = note
    ? '<span class="ccard-row-note">' + escHtml(note) + '</span>'
    : '';
  return '<div class="ccard-row" role="listitem">'
    + '<div class="ccard-row-main">'
    + '<span class="ccard-dot ' + statusDotClass(dotStatus) + '" aria-hidden="true"></span>'
    + '<span class="ccard-row-name">' + escHtml(name) + '</span>'
    + noteHtml
    + '</div>'
    + (tools ? '<span class="ccard-row-tools">' + tools + '</span>' : '')
    + '</div>';
}

export function activityHtml(contract, options = {}) {
  const sessions = contract.sessions || [];
  const free = freeSessions(contract);
  const soloAgent = soloStatusBarAgent(contract);
  const skipAgentId = soloAgent && soloAgent.id;
  const rendered = new Set();
  const rows = [];

  (contract.agents || []).forEach((agent) => {
    const inspectable = free.find(session => session.inspectable && session.agentId === agent.id);
    if (skipAgentId && agent.id === skipAgentId) {
      // Solo status bar already shows this agent + session; do not repeat in ccard-rows.
      if (inspectable) rendered.add(inspectable.sessionId);
      return;
    }
    const ownsStageSession = sessions.some(session => session.stageOwned && session.agentId === agent.id);
    if (contract.plan && ownsStageSession) return;
    if (inspectable) rendered.add(inspectable.sessionId);
    rows.push(rowHtml(
      agent.status,
      agentDisplay(agent.id),
      agentRowNote(agent, contract),
      agentRowToolsHtml(contract, agent.id, options),
    ));
  });

  free
    .filter(session => session.inspectable && !rendered.has(session.sessionId))
    .forEach((session) => {
      const note = sessionRowNote(session, contract);
      const tools = agentRowToolsHtml(contract, session.agentId, options) || peekButtonHtml(session, options);
      rows.push(rowHtml(
        session.sessionStatus || (session.running ? 'running' : 'complete'),
        agentDisplay(session.agentId),
        note,
        tools,
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
