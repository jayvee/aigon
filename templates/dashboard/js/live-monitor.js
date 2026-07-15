/* dashboard-esm-processed */

import { handleFeatureAction, handleSetAction } from './actions.js';
import { partitionCardActions, actionButtonHtml } from './contract-cards/actions-view.js';
import { activityHtml, blockersHtml } from './contract-cards/activity-view.js';
import { escHtml, peekButtonHtml, statusLabel, agentDisplay } from './contract-cards/html.js';
import { runPlanHtml, setPlanHtml } from './contract-cards/plan-view.js';
import { renderContractCardBody } from './contract-cards/card.js';
import { state } from './state.js';
import { openTerminalPanel } from './terminal.js';
import { relTime } from './utils.js';

const MOBILE_DETAIL_MQ = '(max-width: 760px)';
let selectedKey = null;
let mobileDetailOpen = false;
let clickBound = false;

function liveRoot() {
  return document.getElementById('monitor-live-root');
}

function legacyRoot() {
  return document.getElementById('monitor-legacy-root');
}

function ensureClickBinding() {
  if (clickBound) return;
  const host = document.getElementById('monitor-view');
  if (!host) return;
  clickBound = true;
  host.addEventListener('click', handleLiveMonitorClick);
}

function hasLiveMonitorPreview(data) {
  return (data && data.repos || []).some(repo => repo && repo.contractCardsPreview === true);
}

function filterProjection(data) {
  const projection = data && data.monitorOperational;
  if (!projection) return null;
  const selectedRepo = state.selectedRepo;
  if (selectedRepo === 'all') return projection;

  const filterGroup = (items) => (items || []).filter(item => item.repoPath === selectedRepo);
  const groups = {
    needsAttention: filterGroup(projection.groups.needsAttention),
    running: filterGroup(projection.groups.running),
    recentlyCompleted: filterGroup(projection.groups.recentlyCompleted),
  };
  const sessionIds = new Set();
  Object.values(groups).flat().forEach((item) => {
    (item.contract.sessions || []).forEach((session) => {
      if (session.inspectable && session.sessionId) sessionIds.add(session.sessionId);
    });
  });
  return {
    retentionMinutes: projection.retentionMinutes,
    summary: {
      needsAttention: groups.needsAttention.length,
      running: groups.running.length,
      sessionsAvailable: sessionIds.size,
      recentlyCompleted: groups.recentlyCompleted.length,
    },
    groups,
  };
}

function allItems(projection) {
  if (!projection) return [];
  return [
    ...(projection.groups.needsAttention || []),
    ...(projection.groups.running || []),
    ...(projection.groups.recentlyCompleted || []),
  ];
}

function resolveSelection(projection) {
  const items = allItems(projection);
  if (!items.length) {
    selectedKey = null;
    return null;
  }
  if (selectedKey && items.some(item => item.key === selectedKey)) return selectedKey;
  selectedKey = items[0].key;
  return selectedKey;
}

function findItem(projection, key) {
  return allItems(projection).find(item => item.key === key) || null;
}

function findEntityRow(item) {
  const data = state.data || { repos: [] };
  const repo = (data.repos || []).find(r => r.path === item.repoPath);
  if (!repo) return { repo: null, entity: null, pipelineType: 'features' };
  if (item.entityType === 'feature') {
    return { repo, entity: (repo.features || []).find(f => String(f.id) === String(item.entityId)), pipelineType: 'features' };
  }
  if (item.entityType === 'research') {
    return { repo, entity: (repo.research || []).find(r => String(r.id) === String(item.entityId)), pipelineType: 'research' };
  }
  return { repo, entity: (repo.sets || []).find(s => String(s.slug) === String(item.entityId)), pipelineType: 'sets' };
}

function queuePeekHtml(item) {
  const sessions = (item.contract.sessions || []).filter(session => session.inspectable);
  const preferred = sessions.find(session => session.running) || sessions[0];
  return preferred ? peekButtonHtml(preferred, { compact: true }) : '';
}

function queueActionHtml(item) {
  const { primary } = partitionCardActions(item.contract, { compact: true });
  return primary ? actionButtonHtml(primary, 'ccard-action') : '';
}

function queueItemHtml(item, active) {
  const attention = item.group === 'needsAttention';
  const identity = item.entityType === 'feature-set'
    ? escHtml(item.identity.name)
    : escHtml(item.identity.displayKey + ' ' + item.identity.name);
  return '<div role="button" tabindex="0" class="monitor-item' + (attention ? ' attention' : '') + (active ? ' active' : '')
    + '" data-monitor-key="' + escHtml(item.key) + '">'
    + '<span class="monitor-item-dot"></span>'
    + '<span class="monitor-item-copy"><strong>' + identity + '</strong><span>'
    + escHtml(item.activityLine) + '</span></span>'
    + '<span class="monitor-item-tools">' + queueActionHtml(item) + queuePeekHtml(item)
    + '<span class="monitor-item-time">' + escHtml(relTime(item.updatedAt)) + '</span></span>'
    + '</div>';
}

function eventsHtml(item) {
  const timeline = (item.contract.presentation && item.contract.presentation.timeline) || [];
  const history = item.contract.history || [];
  const rows = [];
  timeline.slice().reverse().forEach((entry) => {
    const label = [entry.label, entry.detail].filter(Boolean).join(' — ');
    if (!label) return;
    rows.push('<div class="monitor-event"><time>—</time><span>' + escHtml(label) + '</span></div>');
  });
  history.slice().reverse().forEach((entry) => {
    const label = entry.label || entry.message || entry.type || '';
    if (!label) return;
    const when = entry.at ? relTime(entry.at) : '—';
    rows.push('<div class="monitor-event"><time>' + escHtml(when) + '</time><span>' + escHtml(label) + '</span></div>');
  });
  if (!rows.length) return '<div class="monitor-event"><time>—</time><span>No recent events recorded</span></div>';
  return rows.join('');
}

function extraSessionsHtml(item) {
  const contract = item.contract;
  const owned = new Set(contract.plan && contract.plan.ownedSessionIds || []);
  if (contract.plan && contract.plan.controllerSessionId) owned.add(contract.plan.controllerSessionId);
  const extra = (contract.sessions || []).filter(session => session.inspectable && !owned.has(session.sessionId) && !session.stageOwned);
  if (!extra.length) return '';
  return '<h3>Other sessions</h3>' + extra.map((session) => (
    '<div class="monitor-session">'
    + '<span class="ccard-dot ' + escHtml(session.sessionStatus || 'running') + '"></span>'
    + '<span><strong>' + escHtml(agentDisplay(session.agentId)) + '</strong>'
    + '<small>' + escHtml(statusLabel(session.role || session.sessionStatus)) + '</small></span>'
    + peekButtonHtml(session, {})
    + '</div>'
  )).join('');
}

function progressHtml(item) {
  const contract = item.contract;
  if (item.entityType === 'feature-set') {
    return setPlanHtml(contract, {
      renderEmbedded: embedded => renderContractCardBody(embedded, {
        density: 'expanded',
        suppressActions: true,
        suppressIdentity: true,
      }),
    });
  }
  return runPlanHtml(contract, {}) || activityHtml(contract, {});
}

function focusHtml(item) {
  if (!item) {
    return '<section class="monitor-focus"><header class="monitor-panel-header"><h2>Run detail</h2><span>Select a run</span></header>'
      + '<div class="monitor-focus-body"><p class="monitor-live-empty">Select an item from the queue to inspect run progress, sessions, and decisions.</p></div></section>';
  }
  const contract = item.contract;
  const entity = contract.entity || {};
  const severity = contract.state && contract.state.severity;
  const copyClass = severity === 'error' || severity === 'warning' ? '' : ' is-normal';
  const { primary, secondary } = partitionCardActions(contract, {});
  const actions = [primary, ...secondary].filter(Boolean).slice(0, 2)
    .map(action => actionButtonHtml(action, 'ccard-action' + (action === primary ? ' is-primary' : ''))).join('');
  const badge = item.entityType === 'feature-set'
    ? escHtml(entity.name || item.identity.name)
    : escHtml((entity.displayKey || item.identity.displayKey) + ' · ' + (contract.state && contract.state.label || ''));

  return '<section class="monitor-focus">'
    + '<header class="monitor-panel-header"><h2>Run detail</h2><span>Updated ' + escHtml(relTime(item.updatedAt)) + '</span></header>'
    + '<div class="monitor-focus-body">'
    + '<div class="monitor-focus-title">'
    + '<div><span class="ccard-key">' + badge + '</span><h2>' + escHtml(entity.title || entity.name || item.identity.name) + '</h2></div>'
    + '<div class="monitor-focus-actions">' + actions + '</div></div>'
    + '<p class="monitor-focus-copy' + copyClass + '"><strong>' + escHtml(item.activityLine) + '</strong>'
    + (item.contextLine ? '<br>' + escHtml(item.contextLine) : '') + '</p>'
    + blockersHtml(contract)
    + '<div class="monitor-detail-grid">'
    + '<section class="monitor-detail-section"><h3>Run progress</h3>' + (progressHtml(item) || '<span class="no-actions">No active run plan</span>') + '</section>'
    + '<section class="monitor-detail-section">' + extraSessionsHtml(item)
    + '<h3>Recent events</h3>' + eventsHtml(item) + '</section>'
    + '</div></div></section>';
}

function repoScopeLabel(data) {
  if (state.selectedRepo === 'all') return 'All repositories';
  const repo = (data.repos || []).find(r => r.path === state.selectedRepo);
  return repo ? (repo.name || repo.displayPath || 'Selected repo') : 'Selected repo';
}

function emptyMessage(projection) {
  const total = (projection.summary.needsAttention || 0)
    + (projection.summary.running || 0)
    + (projection.summary.recentlyCompleted || 0);
  if (total > 0) return '';
  if (state.selectedRepo !== 'all') return 'No live work in the selected repository.';
  return 'No running work or attention items. Recently completed runs stay visible for '
    + (projection.retentionMinutes || 120) + ' minutes.';
}

function renderLiveMonitor(data) {
  const root = liveRoot();
  if (!root) return;
  const projection = filterProjection(data);
  if (!projection) {
    root.innerHTML = '';
    root.hidden = true;
    return;
  }

  resolveSelection(projection);
  const selected = findItem(projection, selectedKey);
  const isEmpty = !allItems(projection).length;
  const sections = [
    { key: 'needsAttention', label: 'NEEDS ATTENTION' },
    { key: 'running', label: 'RUNNING' },
    { key: 'recentlyCompleted', label: 'RECENTLY COMPLETED' },
  ];

  const queueSections = sections.map((section) => {
    const items = projection.groups[section.key] || [];
    if (!items.length) return '';
    return '<div class="monitor-section-label">' + section.label + '</div>'
      + items.map(item => queueItemHtml(item, item.key === selectedKey)).join('');
  }).join('');

  root.hidden = false;
  root.dataset.empty = isEmpty ? 'true' : 'false';
  root.dataset.mobileDetail = mobileDetailOpen ? 'true' : 'false';
  root.className = 'monitor-live-root';
  root.innerHTML = ''
    + '<button type="button" class="btn btn-sm monitor-mobile-back" data-monitor-back>← Back to queue</button>'
    + '<div class="monitor-summary" aria-label="Live operations summary">'
    + '<div class="monitor-stat"><strong>' + projection.summary.needsAttention + '</strong><span>Need attention</span></div>'
    + '<div class="monitor-stat"><strong>' + projection.summary.running + '</strong><span>Runs active</span></div>'
    + '<div class="monitor-stat"><strong>' + projection.summary.sessionsAvailable + '</strong><span>Sessions available</span></div>'
    + '<div class="monitor-stat"><strong>' + projection.summary.recentlyCompleted + '</strong><span>Completed recently</span></div>'
    + '</div>'
    + (isEmpty ? '<div class="monitor-live-empty">' + escHtml(emptyMessage(projection)) + '</div>' : '')
    + '<div class="monitor-layout">'
    + '<aside class="monitor-queue">'
    + '<header class="monitor-panel-header"><h2>Live work</h2><span>' + escHtml(repoScopeLabel(data)) + '</span></header>'
    + queueSections
    + '</aside>'
    + focusHtml(selected)
    + '</div>';

  ensureClickBinding();
}

function handleLiveMonitorClick(event) {
  const root = liveRoot();
  if (!root || root.hidden) return;
  const back = event.target.closest('[data-monitor-back]');
  if (back) {
    mobileDetailOpen = false;
    renderLiveMonitor(state.data);
    return;
  }

  const peekBtn = event.target.closest('.kcard-peek-btn');
  if (peekBtn) {
    event.stopPropagation();
    const sessionName = peekBtn.getAttribute('data-peek-session') || '';
    if (sessionName) openTerminalPanel(sessionName, null, sessionName, null, null);
    return;
  }

  const actionBtn = event.target.closest('.kcard-va-btn');
  if (actionBtn) {
    event.stopPropagation();
    const container = actionBtn.closest('.monitor-item');
    const key = container && container.getAttribute('data-monitor-key');
    const projection = filterProjection(state.data);
    const item = key ? findItem(projection, key) : (selectedKey ? findItem(projection, selectedKey) : null);
    if (!item) return;

    const { repo, entity, pipelineType } = findEntityRow(item);
    if (!repo || !entity) return;
    const vaAction = actionBtn.getAttribute('data-va-action') || '';
    const vaAgentId = actionBtn.getAttribute('data-agent') || null;
    const va = (entity.validActions || []).find(a => a.action === vaAction && (a.agentId || null) === vaAgentId)
      || { action: vaAction, agentId: vaAgentId, label: actionBtn.textContent };
    actionBtn._origText = actionBtn.textContent;
    if (item.entityType === 'feature-set') handleSetAction(va, entity, repo.path, actionBtn);
    else handleFeatureAction(va, entity, repo.path, actionBtn, pipelineType);
    return;
  }

  const queueItem = event.target.closest('[data-monitor-key]');
  if (queueItem && queueItem.classList.contains('monitor-item')) {
    selectedKey = queueItem.getAttribute('data-monitor-key');
    if (window.matchMedia(MOBILE_DETAIL_MQ).matches) mobileDetailOpen = true;
    renderLiveMonitor(state.data);
    return;
  }
}

export function syncLiveMonitor(data) {
  const enabled = hasLiveMonitorPreview(data);
  const legacy = legacyRoot();
  const legacyToolbar = document.querySelector('#monitor-view .monitor-toolbar');
  const legacySummary = document.getElementById('monitor-summary');
  if (legacy) legacy.hidden = enabled;
  if (legacyToolbar) legacyToolbar.hidden = enabled;
  if (legacySummary) legacySummary.style.display = enabled ? 'none' : '';

  const root = liveRoot();
  if (!enabled) {
    if (root) {
      root.hidden = true;
      root.innerHTML = '';
    }
    return;
  }
  renderLiveMonitor(data);
}

export function isLiveMonitorEnabled(data) {
  return hasLiveMonitorPreview(data);
}
