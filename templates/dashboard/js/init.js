/* dashboard-esm-processed */

import { getLastKanbanReconcileStats } from './pipeline.js';
import { renderUpdateBadge, updateTitleAndFavicon } from './monitor.js';
import { POLL_MS, TS_MS, state } from './state.js';
import { replaceData, setFailures, setLastRenderedStatusVersion, setLastStatusVersion, toggleSidebarHidden } from './store.js';
import { copyText, escHtml, relTime, showToast } from './utils.js';
    function flattenStatuses(data) {
      const map = new Map();
      (data.repos || []).forEach(repo => {
        (repo.features || []).forEach(feature => {
          (feature.agents || []).forEach(agent => {
            map.set(repo.path + ':' + feature.id + ':' + agent.id, { status: agent.status, cmd: agent.slashCommand });
          });
        });
      });
      return map;
    }

    function etagFromResponse(res) {
      const raw = res.headers.get('etag');
      if (!raw) return null;
      return raw.replace(/^W\//i, '').replace(/^"|"$/g, '');
    }

    // F590: client-side poll instrumentation. Off by default; enable with
    // `?debug=perf` in the URL or `localStorage.aigon-debug-perf = '1'`. Emits a
    // one-line breakdown of fetch vs parse vs flatten/fingerprint vs render so a
    // future slowdown self-reports without hand-added timing.
    function isPerfDebugOn() {
      try {
        if (new URLSearchParams(location.search).get('debug') === 'perf') return true;
        return localStorage.getItem('aigon-debug-perf') === '1';
      } catch (_) { return false; }
    }

    function render() {
      applyView();
    }

    async function poll() {
      const perfOn = isPerfDebugOn();
      const perf = perfOn ? { t0: performance.now(), bytes: 0, fetchMs: 0, parseMs: 0, renderMs: 0, rendered: false, notModified: false } : null;
      const previous = flattenStatuses(state.data || {});
      const previousData = state.data || {};
      try {
        const tFetch = perfOn ? performance.now() : 0;
        const headers = {};
        if (state.lastStatusVersion != null) headers['If-None-Match'] = `"${state.lastStatusVersion}"`;
        const res = await fetch('/api/status', { cache: 'no-store', headers });
        if (res.status === 304) {
          setFailures(0);
          setHealth();
          refreshTimestamps();
          if (perfOn) {
            perf.fetchMs = Math.round((performance.now() - tFetch) * 100) / 100;
            perf.notModified = true;
            const totalMs = Math.round((performance.now() - perf.t0) * 100) / 100;
            console.log(`[aigon perf] poll total=${totalMs}ms fetch=${perf.fetchMs}ms 304`);
          }
          return;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (perfOn) {
          perf.fetchMs = Math.round((performance.now() - tFetch) * 100) / 100;
          perf.bytes = Number(res.headers.get('content-length')) || 0;
        }
        const tParse = perfOn ? performance.now() : 0;
        const next = await res.json();
        if (perfOn) perf.parseMs = Math.round((performance.now() - tParse) * 100) / 100;
        const etag = etagFromResponse(res);
        const incomingVersion = etag != null ? Number(etag) : next.statusVersion;
        if (incomingVersion != null && state.lastStatusVersion != null && incomingVersion < state.lastStatusVersion) {
          setFailures(0);
          setHealth();
          refreshTimestamps();
          return;
        }
        if (etag != null) setLastStatusVersion(Number(etag));
        else if (next.statusVersion != null) setLastStatusVersion(next.statusVersion);
        const prevVersion = state._lastRenderedStatusVersion;
        setFailures(0);
        const current = flattenStatuses(next);
        current.forEach((v, k) => {
          const prev = previous.get(k);
          if (!prev) return;
          if (prev.status !== 'waiting' && v.status === 'waiting') {
            showToast('Agent is waiting', v.cmd ? 'Copy command' : null, v.cmd ? () => copyText(v.cmd).then(() => showToast('Copied: ' + v.cmd)) : null);
          }
          if (prev.status !== 'error' && v.status === 'error') showToast('Agent entered error state', null, null, {error:true});
        });
        replaceData(next);
        document.getElementById('updated-text').textContent = 'Updated ' + relTime((state.data || {}).generatedAt || new Date().toISOString());
        updateTitleAndFavicon(((state.data || {}).summary || {}).waiting || 0);
        if (state.view === 'settings') {
          if (settingsNeedsRerender(previousData, state.data)) renderSettings();
        } else if (incomingVersion !== prevVersion) {
          setLastRenderedStatusVersion(incomingVersion);
          const tRender = perfOn ? performance.now() : 0;
          updateActiveView(state.data, { prevData: previousData, statusChanged: true });
          if (perfOn) { perf.renderMs = Math.round((performance.now() - tRender) * 100) / 100; perf.rendered = true; }
        }
        setHealth();
        renderUpdateBadge();
        if (perfOn) {
          const totalMs = Math.round((performance.now() - perf.t0) * 100) / 100;
          const kb = perf.bytes ? ` wire=${Math.round(perf.bytes / 1024)}KB` : '';
          const kStats = typeof getLastKanbanReconcileStats === 'function' ? getLastKanbanReconcileStats() : null;
          const kanbanPart = kStats && perf.rendered
            ? ` kanban=+${kStats.created}/~${kStats.updated}/-${kStats.removed}`
            : '';
          console.log(`[aigon perf] poll total=${totalMs}ms fetch=${perf.fetchMs}ms parse=${perf.parseMs}ms render=${perf.rendered ? perf.renderMs + 'ms' : 'skipped'}${kanbanPart}${kb}`);
        }
      } catch (e) {
        setFailures(state.failures + 1);
        setHealth();
        // feature 234: while a restart is in progress, poll aggressively (500ms)
        // until the new server answers, so the banner clears within ~2s.
        if (state.serverRestarting) setTimeout(poll, 500);
      }
    }

    function refreshTimestamps() {
      document.querySelectorAll('[data-updated]').forEach(n => { n.textContent = relTime(n.getAttribute('data-updated')); });
      const generatedAt = (state.data && state.data.generatedAt) ? state.data.generatedAt : new Date().toISOString();
      document.getElementById('updated-text').textContent = 'Updated ' + relTime(generatedAt);
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    initViewShell();
    if (typeof syncDashboardHiddenRepos === 'function') {
      syncDashboardHiddenRepos(state.hiddenRepos || []);
    }
    // Docs link — probe whether local docs server is up, fall back to public site
    fetch('/api/docs-url').then(r => r.json()).then(({ url }) => {
      const docsLink = document.getElementById('docs-link');
      if (!docsLink) return;
      docsLink.href = url;
      docsLink.title = url.startsWith('http://localhost') ? 'Open docs (local)' : 'Open Aigon docs';
    }).catch(() => {});  // fallback: keep the href baked into the HTML
    document.getElementById('refresh-btn').onclick = requestRefresh;
    document.getElementById('sidebar-toggle-btn').onclick = () => {
      toggleSidebarHidden();
      applyView();
    };
    setInterval(refreshTimestamps, TS_MS);
    let pollTimer = null;
    function setPollInterval(ms) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(poll, ms);
    }
    setPollInterval(POLL_MS);
    setTimeout(poll, 400);
    if (typeof connectLive === 'function') connectLive();

    // Sidebar resize
    (() => {
      const sidebar = document.getElementById('repo-sidebar');
      const handle = document.getElementById('sidebar-resize');
      const saved = localStorage.getItem('aigon-sidebar-width');
      if (saved) sidebar.style.setProperty('--sidebar-width', saved + 'px');
      let startX, startW;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = sidebar.offsetWidth;
        handle.classList.add('active');
        const onMove = (e) => {
          const w = Math.min(400, Math.max(140, startW + e.clientX - startX));
          sidebar.style.setProperty('--sidebar-width', w + 'px');
        };
        const onUp = () => {
          handle.classList.remove('active');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          localStorage.setItem('aigon-sidebar-width', sidebar.offsetWidth);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    })();

    // ── Notification bell & dropdown ─────────────────────────────────────────

    const notifBellBtn = document.getElementById('notif-bell-btn');
    const notifBadge = document.getElementById('notif-badge');
    const notifDropdown = document.getElementById('notif-dropdown');
    const notifOverlay = document.getElementById('notif-overlay');
    const notifList = document.getElementById('notif-list');
    const notifCloseBtn = document.getElementById('notif-close-btn');

    const NOTIF_TYPE_LABELS_DISPLAY = {
      'agent-waiting': 'Waiting',
      'agent-ready': 'Ready',
      'all-ready': 'All ready',
      'all-research-ready': 'Research ready',
      'error': 'Error'
    };

    function relTimeShort(iso) {
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function renderNotifList(events) {
      if (!events || events.length === 0) {
        notifList.innerHTML = '<div class="notif-empty">No notifications yet</div>';
        return;
      }
      notifList.innerHTML = '';
      [...events].reverse().forEach(ev => {
        const item = document.createElement('div');
        item.className = 'notif-item' + (ev.read ? '' : ' unread');
        item.style.cursor = 'pointer';
        const typeLabel = NOTIF_TYPE_LABELS_DISPLAY[ev.type] || ev.type;
        item.innerHTML =
          '<div class="notif-item-type ' + ev.type + '">' + escHtml(typeLabel) + '</div>' +
          '<div class="notif-item-msg">' + escHtml(ev.message) + '</div>' +
          '<div class="notif-item-time">' + relTimeShort(ev.timestamp) + '</div>';
        item.onclick = () => {
          closeNotifDropdown();
        };
        notifList.appendChild(item);
      });
    }

    function updateBadge(count) {
      if (count > 0) {
        notifBadge.textContent = count > 99 ? '99+' : String(count);
        notifBadge.removeAttribute('data-hidden');
      } else {
        notifBadge.setAttribute('data-hidden', '');
      }
    }

    async function loadNotifications() {
      try {
        const r = await fetch('/api/notifications');
        if (!r.ok) return;
        const data = await r.json();
        updateBadge(data.unreadCount || 0);
        return data.events || [];
      } catch (_) { return []; }
    }

    async function openNotifDropdown() {
      const events = await loadNotifications();
      renderNotifList(events);
      notifDropdown.classList.add('open');
      notifOverlay.classList.add('open');
      // Mark all as read
      try { await fetch('/api/notifications/read', { method: 'POST' }); } catch (_) {}
      updateBadge(0);
    }

    function closeNotifDropdown() {
      notifDropdown.classList.remove('open');
      notifOverlay.classList.remove('open');
    }

    notifBellBtn.onclick = () => {
      if (notifDropdown.classList.contains('open')) closeNotifDropdown();
      else openNotifDropdown();
    };
    notifCloseBtn.onclick = closeNotifDropdown;
    notifOverlay.onclick = closeNotifDropdown;

    // Initial badge load (F622: push via SSE notification events replaces 30s poll)
    loadNotifications();

// ── ESM exports (F623) ──
export { loadNotifications, poll, refreshTimestamps, render, setPollInterval };
Object.assign(globalThis, { loadNotifications, poll, refreshTimestamps, render, setPollInterval });
