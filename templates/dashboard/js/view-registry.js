/* dashboard-esm-processed */

import { renderAllItemsView, renderLogs, renderStatistics } from './logs.js';
import { renderUpdateBadge, setHealth, updateTitleAndFavicon, updateViewTabs } from './monitor.js';
import { syncLiveMonitor } from './live-monitor.js';
import { renderRepoHeader, renderSidebar } from './sidebar.js';
import { renderSettings } from './settings.js';
import { setView, state } from './store.js';
import { relTime } from './utils.js';
import { createInsightsView } from './views/insights-view.js';
import { createSessionsView } from './views/sessions-view.js';

export const VALID_VIEW_IDS = [
  'monitor', 'pipeline', 'sessions', 'statistics', 'insights', 'logs', 'all-items', 'settings',
];

let activeViewId = null;
let lastSelectedRepo = null;
let logsMounted = false;
let allItemsMounted = false;

function listRepoPaths(data) {
  return ((data && data.repos) || []).map(repo => repo.path);
}

function settingsNeedsRerender(previousData, nextData) {
  const previousRepos = listRepoPaths(previousData);
  const nextRepos = listRepoPaths(nextData);
  if (previousRepos.length !== nextRepos.length) return true;
  for (let i = 0; i < previousRepos.length; i += 1) {
    if (previousRepos[i] !== nextRepos[i]) return true;
  }
  return false;
}

function validateContainers(registry) {
  for (const entry of registry) {
    if (!entry.elementId) continue;
    if (!document.getElementById(entry.elementId)) {
      console.error(`[aigon view-registry] missing container #${entry.elementId} for view "${entry.id}"`);
    }
  }
}

function updateSidebarToggle(viewId) {
  const btn = document.getElementById('sidebar-toggle-btn');
  if (!btn) return;
  const entry = VIEW_REGISTRY.find(v => v.id === viewId);
  const enabled = entry ? entry.usesRepoSidebar : false;
  btn.style.display = enabled ? '' : 'none';
  btn.setAttribute('aria-label', state.sidebarHidden ? 'Show sidebar' : 'Hide sidebar');
  btn.setAttribute('title', state.sidebarHidden ? 'Show sidebar' : 'Hide sidebar');
  btn.classList.toggle('is-hidden', !!state.sidebarHidden);
}

function updateOperationalWrap(viewId) {
  const wrap = document.querySelector('.wrap');
  if (!wrap) return;
  wrap.classList.toggle('wrap--operational', viewId === 'pipeline' || viewId === 'monitor');
}

function applyChromeVisibility(viewId) {
  updateOperationalWrap(viewId);
  const entry = VIEW_REGISTRY.find(v => v.id === viewId);
  if (!entry) return;

  const sidebar = document.getElementById('repo-sidebar');
  const mobileSelect = document.getElementById('repo-select-mobile');
  const repoHeader = document.getElementById('repo-header');
  const empty = document.getElementById('empty');
  const monitorSummary = document.getElementById('monitor-summary');

  if (sidebar) sidebar.style.display = entry.usesRepoSidebar ? (state.sidebarHidden ? 'none' : '') : 'none';
  if (mobileSelect) mobileSelect.style.display = entry.usesRepoSidebar ? '' : 'none';
  if (repoHeader) repoHeader.style.display = entry.usesRepoHeader ? '' : 'none';
  if (empty) empty.style.display = 'none';
  if (monitorSummary) monitorSummary.style.display = 'none';

  for (const view of VIEW_REGISTRY) {
    if (view.alpineVisibility) continue;
    const el = document.getElementById(view.elementId);
    if (!el) continue;
    el.style.display = view.id === viewId ? 'block' : 'none';
  }
}

function renderRepoChrome(data) {
  const allRepos = ((data || {}).repos || []);
  renderSidebar(allRepos);
  const selectedRepoData = state.selectedRepo !== 'all' ? allRepos.find(r => r.path === state.selectedRepo) : null;
  renderRepoHeader(selectedRepoData);
  setHealth();
  renderUpdateBadge();
  updateTitleAndFavicon(((data || {}).summary || {}).waiting || 0);
  const updatedText = document.getElementById('updated-text');
  if (updatedText) {
    updatedText.textContent = 'Updated ' + relTime((data || {}).generatedAt || new Date().toISOString());
  }
}

const sessionsView = createSessionsView();
const insightsView = createInsightsView();

const VIEW_REGISTRY = [
  {
    id: 'monitor',
    elementId: 'monitor-view',
    usesRepoSidebar: true,
    usesRepoHeader: true,
    alpineVisibility: true,
    mount() { renderRepoChrome(state.data); syncLiveMonitor(state.data); },
    update(data) { renderRepoChrome(data); syncLiveMonitor(data); },
    unmount() {},
  },
  {
    id: 'pipeline',
    elementId: 'pipeline-view',
    usesRepoSidebar: true,
    usesRepoHeader: true,
    alpineVisibility: true,
    mount() { renderRepoChrome(state.data); },
    update(data) { renderRepoChrome(data); },
    unmount() {},
  },
  sessionsView,
  {
    id: 'statistics',
    elementId: 'statistics-view',
    usesRepoSidebar: true,
    usesRepoHeader: false,
    alpineVisibility: false,
    mount() {
      renderRepoChrome(state.data);
      renderStatistics();
    },
    update(data, ctx) {
      if (ctx && (ctx.repoListChanged || ctx.statusChanged)) renderStatistics();
    },
    unmount() {},
  },
  insightsView,
  {
    id: 'logs',
    elementId: 'logs-view',
    usesRepoSidebar: false,
    usesRepoHeader: false,
    alpineVisibility: false,
    mount() {
      logsMounted = true;
      renderLogs();
    },
    update() {},
    unmount() { logsMounted = false; },
  },
  {
    id: 'all-items',
    elementId: 'all-items-view',
    usesRepoSidebar: false,
    usesRepoHeader: false,
    alpineVisibility: false,
    mount() {
      allItemsMounted = true;
      renderAllItemsView();
    },
    update(data, ctx) {
      if (!allItemsMounted) return;
      if (ctx && (ctx.statusChanged || ctx.repoListChanged)) renderAllItemsView();
    },
    unmount() { allItemsMounted = false; },
  },
  {
    id: 'settings',
    elementId: 'settings-view',
    usesRepoSidebar: false,
    usesRepoHeader: false,
    alpineVisibility: false,
    mount() { renderSettings(); },
    update(_data, ctx) {
      if (ctx && ctx.repoListChanged) renderSettings();
    },
    unmount() {},
  },
];

validateContainers(VIEW_REGISTRY);

function getEntry(viewId) {
  return VIEW_REGISTRY.find(v => v.id === viewId) || VIEW_REGISTRY.find(v => v.id === 'pipeline');
}

function switchViewLifecycle(nextId) {
  const prevId = activeViewId;
  if (prevId === nextId) return false;

  const prevEntry = prevId ? getEntry(prevId) : null;
  const nextEntry = getEntry(nextId);

  if (prevEntry && typeof prevEntry.unmount === 'function') prevEntry.unmount();
  activeViewId = nextId;
  applyChromeVisibility(nextId);
  updateSidebarToggle(nextId);
  updateViewTabs();
  if (nextEntry && typeof nextEntry.mount === 'function') nextEntry.mount();
  return true;
}

export function applyView(options) {
  const opts = options || {};
  const viewId = state.view;

  const switched = switchViewLifecycle(viewId);
  if (!switched && !opts.forceUpdate) {
    const entry = getEntry(viewId);
    if (entry && entry.usesRepoSidebar) renderRepoChrome(state.data);
    updateActiveView(state.data, { selectedRepoChanged: lastSelectedRepo !== state.selectedRepo });
    return;
  }

  if (!switched && opts.forceUpdate) {
    const entry = getEntry(viewId);
    if (entry && typeof entry.mount === 'function') entry.mount();
  }
}

export function updateActiveView(data, ctx) {
  const entry = getEntry(state.view);
  if (!entry || typeof entry.update !== 'function') return;

  const updateCtx = {
    ...(ctx || {}),
    selectedRepoChanged: lastSelectedRepo !== state.selectedRepo,
    repoListChanged: ctx && ctx.prevData != null ? settingsNeedsRerender(ctx.prevData, data) : false,
  };
  entry.update(data, updateCtx);
  lastSelectedRepo = state.selectedRepo;

  if (entry.usesRepoSidebar && (updateCtx.selectedRepoChanged || updateCtx.repoListChanged || updateCtx.statusChanged)) {
    renderRepoChrome(data);
  }
}

export function initViewShell() {
  lastSelectedRepo = state.selectedRepo;
  applyView({ forceUpdate: true });

  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.onclick = () => {
      setView(tab.getAttribute('data-view'));
    };
  });
}

export { settingsNeedsRerender };
