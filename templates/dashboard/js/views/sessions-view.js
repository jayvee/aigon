/* dashboard-esm-processed */

import { state } from '../state.js';
import { getTerminalClickTarget, openTerminalPanel } from '../terminal.js';
import { escHtml, relTime, showToast } from '../utils.js';
const SESSIONS_UPDATE_DEBOUNCE_MS = 500;

export function createSessionsView() {
  let abortController = null;
  let sessions = [];
  let orphanCount = 0;
  let mounted = false;
  let updateTimer = null;
  let cachedAt = 0;

  function getContainer() {
    return document.getElementById('sessions-view');
  }

  function abortInFlight() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  function entityBadge(s) {
    if (!s.entityType) return '';
    if (s.entityType === 'S') {
      return '<span class="session-entity-badge feature" title="Set autonomous (orchestrates members)">set ' + escHtml(s.entityId) + '</span>';
    }
    const label = s.entityType + s.entityId;
    const cls = s.entityType === 'f' ? 'feature' : 'research';
    return '<span class="session-entity-badge ' + cls + '">' + escHtml(label) + '</span>';
  }

  function repoBadge(s) {
    if (!s.repoPath) return '';
    const name = s.repoPath.split('/').pop();
    return '<span class="session-entity-badge session-entity-badge--neutral">' + escHtml(name) + '</span>';
  }

  function statusBadge(s) {
    if (s.orphan) {
      const reasonLabels = { done: 'feature done', paused: 'feature paused', 'spec-missing': 'spec deleted' };
      const label = reasonLabels[s.orphan.reason] || 'orphan';
      const entity = s.entityType && s.entityId ? ' — ' + s.entityType.toUpperCase() + s.entityId : '';
      const tip = s.orphan.reason === 'done' ? 'This session\'s feature has been completed'
        : s.orphan.reason === 'paused' ? 'This session\'s feature is paused'
        : s.orphan.reason === 'spec-missing' ? 'No spec file found for this session\'s feature'
        : 'Session has no active feature';
      return '<span class="session-orphan-badge" title="' + escHtml(tip + entity) + '">' + label + entity + '</span>';
    }
    if (s.attached) return '<span class="session-attached-badge">attached</span>';
    return '';
  }

  function renderGroup(target, title, items, opts) {
    if (items.length === 0) return;
    const group = document.createElement('div');
    group.className = 'sessions-group';
    const titleCls = 'sessions-group-title' + (opts && opts.orphan ? ' orphan-title' : '');
    group.innerHTML = '<div class="' + titleCls + '">' + escHtml(title) + ' (' + items.length + ')</div>';
    items.forEach(s => {
      const row = document.createElement('div');
      const rowCls = 'session-row' + (s.attached ? ' attached' : '') + (s.orphan ? ' orphan' : '');
      row.className = rowCls;
      const age = relTime(s.createdAt);
      row.innerHTML =
        '<span class="session-name" title="' + escHtml(s.name) + '">' + escHtml(s.name) + '</span>' +
        entityBadge(s) +
        ((state.selectedRepo || 'all') === 'all' ? repoBadge(s) : '') +
        statusBadge(s) +
        '<span class="session-meta">' + age + '</span>' +
        '<span class="session-actions">' +
          '<button class="btn btn-primary btn-compact" data-session="' + escHtml(s.name) + '">Open</button>' +
          '<button class="btn btn-warn btn-compact" data-kill="' + escHtml(s.name) + '">Kill</button>' +
        '</span>';

      row.querySelector('[data-session]').onclick = async (e) => {
        e.stopPropagation();
        if (getTerminalClickTarget() === 'dashboard') {
          openTerminalPanel(s.name, null, s.name, null, null);
        } else {
          try {
            const res = await fetch('/api/session/view', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionName: s.name, repoPath: s.repoPath || null })
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
            showToast(payload.message || 'Session focused in terminal');
            openTerminalPanel(s.name, null, null, null, null);
          } catch (err) {
            showToast('View failed: ' + err.message, null, null, { error: true });
          }
        }
      };
      row.querySelector('[data-kill]').onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Kill session "' + s.name + '"?')) return;
        await fetch('/api/session/stop', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionName: s.name })
        });
        showToast('Killed: ' + s.name);
        mount({ refresh: true });
      };
      group.appendChild(row);
    });
    target.appendChild(group);
  }

  function renderSessionGroups() {
    const container = getContainer();
    if (!container || !mounted) return;
    container.querySelectorAll('.sessions-group, .empty').forEach(el => el.remove());

    const repoFilter = state.selectedRepo || 'all';
    const filtered = repoFilter === 'all'
      ? sessions
      : sessions.filter(s => s.repoPath === repoFilter || s.name.startsWith('aigon-dash'));
    const dashFiltered = filtered.filter(s => s.name.startsWith('aigon-dash'));
    const orphanFiltered = filtered.filter(s => !s.name.startsWith('aigon-dash') && s.orphan);
    const agentFiltered = filtered.filter(s => !s.name.startsWith('aigon-dash') && !s.orphan);
    const unlinkedSessions = repoFilter === 'all'
      ? sessions.filter(s => !s.repoPath && !s.name.startsWith('aigon-dash') && !s.orphan)
      : [];

    const countLabel = document.getElementById('sessions-count-label');
    if (countLabel) {
      const total = filtered.length;
      countLabel.textContent = total + ' session' + (total === 1 ? '' : 's');
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No sessions for this repo.';
      container.appendChild(empty);
      return;
    }

    renderGroup(container, 'Agent Sessions', agentFiltered);
    renderGroup(container, 'Orphaned Sessions', orphanFiltered, { orphan: true });
    if (unlinkedSessions.length > 0) renderGroup(container, 'Unlinked Sessions', unlinkedSessions);
    renderGroup(container, 'Dashboard Sessions', dashFiltered);
  }

  function buildToolbar(container) {
    const toolbar = document.createElement('div');
    toolbar.className = 'sessions-toolbar';
    toolbar.innerHTML = '<strong class="sessions-title">Tmux Sessions</strong>' +
      '<span class="sessions-count" id="sessions-count-label">' + sessions.length + ' session' + (sessions.length === 1 ? '' : 's') + '</span>' +
      (orphanCount > 0 ? '<button class="btn btn-warn btn-compact-md" id="sessions-kill-orphans-btn">Kill ' + orphanCount + ' Orphan' + (orphanCount === 1 ? '' : 's') + '</button>' : '') +
      '<button class="btn" id="sessions-tile-btn" title="Arrange all iTerm2 windows into a grid">⊞ Tile Windows</button>' +
      '<button class="btn" id="sessions-refresh-btn">↺ Refresh</button>';
    container.appendChild(toolbar);

    document.getElementById('sessions-tile-btn').onclick = async () => {
      try {
        const r = await fetch('/api/tile-windows', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed');
        showToast('Windows tiled');
      } catch (e) { showToast('Tile failed: ' + e.message, null, null, { error: true }); }
    };
    document.getElementById('sessions-refresh-btn').onclick = () => mount({ refresh: true });
    const killOrphansBtn = document.getElementById('sessions-kill-orphans-btn');
    if (killOrphansBtn) {
      killOrphansBtn.onclick = async () => {
        if (!confirm('Kill all ' + orphanCount + ' orphaned session' + (orphanCount === 1 ? '' : 's') + '?')) return;
        try {
          const r = await fetch('/api/sessions/cleanup', { method: 'POST' });
          const d = await r.json();
          showToast('Killed ' + (d.count || 0) + ' orphan' + (d.count === 1 ? '' : 's'));
        } catch (e) { showToast('Cleanup failed: ' + e.message); }
        mount({ refresh: true });
      };
    }
  }

  async function fetchSessions() {
    abortInFlight();
    const controller = new AbortController();
    abortController = controller;
    const container = getContainer();
    if (!container) return false;

    container.innerHTML = '<div class="sessions-loading">Loading sessions…</div>';

    try {
      const res = await fetch('/api/sessions', { signal: controller.signal });
      if (controller.signal.aborted) return false;
      const data = await res.json();
      if (controller.signal.aborted) return false;
      sessions = data.sessions || [];
      orphanCount = data.orphanCount || 0;
      cachedAt = Date.now();
      return true;
    } catch (e) {
      if (controller.signal.aborted) return false;
      container.innerHTML = '<div class="empty">Failed to load sessions: ' + escHtml(e.message) + '</div>';
      return false;
    } finally {
      if (abortController === controller) abortController = null;
    }
  }

  function paintSessions() {
    const container = getContainer();
    if (!container || !mounted) return;
    container.innerHTML = '';
    buildToolbar(container);

    if (sessions.length === 0) {
      container.innerHTML += '<div class="empty">No tmux sessions running.</div>';
      return;
    }
    renderSessionGroups();
  }

  async function mount(options) {
    const opts = options || {};
    mounted = true;
    if (!opts.refresh && cachedAt > 0) {
      paintSessions();
      return;
    }
    const ok = await fetchSessions();
    if (!mounted || !ok) return;
    paintSessions();
  }

  function update(_data, ctx) {
    if (!mounted) return;
    if (ctx && ctx.selectedRepoChanged) {
      renderSessionGroups();
      return;
    }
    if (ctx && ctx.statusChanged) {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = null;
        if (mounted) mount({ refresh: true });
      }, SESSIONS_UPDATE_DEBOUNCE_MS);
    }
  }

  function unmount() {
    mounted = false;
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    abortInFlight();
  }

  return {
    id: 'sessions',
    elementId: 'sessions-view',
    usesRepoSidebar: true,
    usesRepoHeader: false,
    alpineVisibility: false,
    mount,
    update,
    unmount,
  };
}
