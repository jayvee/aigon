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

import { agentDisplay, DEPENDENCY_ICON_SVG, ELAPSED_ICON_SVG, escHtml, formatHeadlineAge, peekButtonHtml, statusDotClass, statusLabel } from './html.js';
import { actionButtonHtml, agentSurfaceActions, overflowMenuHtml, soloSessionActions } from './actions-view.js';

const SESSION_MENU_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

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
  // Compact only agent-owned work into the agent row. Card-level lifecycle
  // states such as Closing must remain a distinct state line.
  if (!headline.owner) return null;
  if (String(headline.owner).toLowerCase() !== String(agent.id).toLowerCase()) return null;
  return agent;
}

function sessionMenuHtml(session, actions) {
  const open = session && (session.affordances || []).find(action => action.actionId === 'open-session');
  const items = [];
  if (open) {
    items.push('<button type="button" class="kcard-overflow-item ccard-session-open" data-session-name="'
      + escHtml(session.sessionId) + '">' + escHtml(open.label) + '</button>');
  }
  items.push(...actions.map(action => actionButtonHtml(action, 'kcard-overflow-item')));
  if (!items.length) return '';
  return '<div class="kcard-overflow ccard-overflow ccard-session-menu">'
    + '<button class="kcard-overflow-toggle ccard-session-menu-toggle" type="button" aria-label="Session options" title="Session options">'
    + SESSION_MENU_ICON_SVG + '</button>'
    + '<div class="kcard-overflow-menu">' + items.join('') + '</div></div>';
}

function sessionControlHtml(peek, menu) {
  if (!peek) return menu;
  return '<span class="ccard-session-control">' + peek + menu + '</span>';
}

/** Peek stays visible; secondary controls share its compact session menu. */
function agentRowToolsHtml(contract, agentId, options) {
  const inspectable = inspectableForAgent(contract, agentId);
  const agentActions = agentSurfaceActions(contract, agentId)
    .filter(action => action.actionId !== 'open-session');
  const peek = inspectable ? peekButtonHtml(inspectable, options) : '';
  const menu = sessionMenuHtml(inspectable, agentActions);
  if (!peek && !menu) return '';
  return sessionControlHtml(peek, menu);
}

function soloToolsHtml(contract, agent, options) {
  const inspectable = inspectableForAgent(contract, agent.id);
  const peek = inspectable ? peekButtonHtml(inspectable, options) : '';
  const sessionActions = soloSessionActions(contract)
    .filter(action => action.actionId !== 'open-session');
  const menu = sessionMenuHtml(inspectable, sessionActions);
  return sessionControlHtml(peek, menu);
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
  const age = headline && headline.ageLabel ? formatHeadlineAge(headline.age) : '';
  const tools = soloToolsHtml(contract, agent, options);
  const elapsedTitle = age ? headline.ageLabel + ' ' + age : '';
  const activeDotClass = headline && headline.tone === 'running' ? ' is-running' : '';
  const ageHtml = age
    ? '<span class="ccard-status-sep" aria-hidden="true">·</span>'
      + '<span class="ccard-status-age" title="' + escHtml(elapsedTitle) + '" aria-label="' + escHtml(elapsedTitle) + '">'
      + ELAPSED_ICON_SVG + '<span>' + escHtml(age) + '</span></span>'
    : '';
  return '<div class="ccard-status-bar">'
    + '<div class="ccard-status-main">'
    + '<span class="ccard-state-dot' + activeDotClass + '" aria-hidden="true"></span>'
    + '<span class="ccard-row-name">' + escHtml(agentDisplay(agent.id)) + '</span>'
    + '<span class="ccard-status-label"><span class="ccard-state-text">' + escHtml(text) + '</span>' + ageHtml + '</span>'
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
  const note = session.presentationLabel || session.label || statusLabel(session.role);
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

export function dependenciesHtml(contract) {
  const blockers = contract.blockers || [];
  const dependencies = blockers.filter(blocker => blocker.kind === 'dependency');
  return dependencies.length
    ? '<div class="ccard-dependencies" role="note" aria-label="Dependencies">'
      + '<span class="ccard-dependencies-label">' + DEPENDENCY_ICON_SVG + 'Depends on</span>'
      + '<span class="ccard-dependency-targets">'
      + dependencies.map((dependency) => (
        '<span class="ccard-dependency-target">'
        + (dependency.displayKey ? '<span class="ccard-dependency-key">' + escHtml(dependency.displayKey) + '</span>' : '')
        + '<span class="ccard-dependency-name">'
        + escHtml(dependency.label || dependency.detail || dependency.reason || dependency.id || 'Dependency')
        + '</span></span>'
      )).join('')
      + '</span></div>'
    : '';
}

export function blockersHtml(contract) {
  const blockers = contract.blockers || [];
  if (!blockers.length) return '';
  const dependencyHtml = dependenciesHtml(contract);
  const attention = blockers.filter(blocker => blocker.kind !== 'dependency');
  const text = attention
    .map(blocker => blocker.label || blocker.detail || blocker.reason || (blocker.id ? 'Blocked by #' + blocker.id : blocker.kind))
    .filter(Boolean)
    .join(' · ');
  const attentionHtml = text
    ? '<div class="ccard-blockers" role="note">' + escHtml(text) + '</div>'
    : '';
  return dependencyHtml + attentionHtml;
}
