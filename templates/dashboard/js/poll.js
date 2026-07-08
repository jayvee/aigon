/* dashboard-esm-processed */
/**
 * Status poll + notification badge fetch — shared by init bootstrap and live SSE.
 * Keeps poll/setPollInterval out of init↔live↔api import cycles (F641).
 */

import { getLastKanbanReconcileStats } from './pipeline.js';
import { renderUpdateBadge, setHealth, updateTitleAndFavicon } from './monitor.js';
import { notifySettingsPoll } from './poll-hooks.js';
import { POLL_MS, state } from './state.js';
import {
  replaceData,
  setFailures,
  setLastRenderedStatusVersion,
  setLastStatusVersion,
} from './store.js';
import { updateActiveView, settingsNeedsRerender } from './view-registry.js';
import { copyText, refreshTimestamps, relTime, showToast } from './utils.js';

function flattenStatuses(data) {
  const map = new Map();
  (data.repos || []).forEach((repo) => {
    (repo.features || []).forEach((feature) => {
      (feature.agents || []).forEach((agent) => {
        map.set(`${repo.path}:${feature.id}:${agent.id}`, {
          status: agent.status,
          cmd: agent.slashCommand,
        });
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

function isPerfDebugOn() {
  try {
    if (new URLSearchParams(location.search).get('debug') === 'perf') return true;
    return localStorage.getItem('aigon-debug-perf') === '1';
  } catch (_) {
    return false;
  }
}

let pollTimer = null;

export function setPollInterval(ms) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, ms);
}

export async function loadNotifications() {
  try {
    const r = await fetch('/api/notifications');
    if (!r.ok) return;
    const data = await r.json();
    const notifBadge = document.getElementById('notif-badge');
    const count = data.unreadCount || 0;
    if (notifBadge) {
      if (count > 0) {
        notifBadge.textContent = count > 99 ? '99+' : String(count);
        notifBadge.removeAttribute('data-hidden');
      } else {
        notifBadge.setAttribute('data-hidden', '');
      }
    }
    return data.events || [];
  } catch (_) {
    return [];
  }
}

export async function poll() {
  const perfOn = isPerfDebugOn();
  const perf = perfOn
    ? { t0: performance.now(), bytes: 0, fetchMs: 0, parseMs: 0, renderMs: 0, rendered: false, notModified: false }
    : null;
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (perfOn) {
      perf.fetchMs = Math.round((performance.now() - tFetch) * 100) / 100;
      perf.bytes = Number(res.headers.get('content-length')) || 0;
    }
    const tParse = perfOn ? performance.now() : 0;
    const next = await res.json();
    if (perfOn) perf.parseMs = Math.round((performance.now() - tParse) * 100) / 100;
    const etag = etagFromResponse(res);
    const incomingVersion = etag != null ? Number(etag) : next.statusVersion;
    if (
      incomingVersion != null
      && state.lastStatusVersion != null
      && incomingVersion < state.lastStatusVersion
    ) {
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
        showToast(
          'Agent is waiting',
          v.cmd ? 'Copy command' : null,
          v.cmd ? () => copyText(v.cmd).then(() => showToast(`Copied: ${v.cmd}`)) : null,
        );
      }
      if (prev.status !== 'error' && v.status === 'error') {
        showToast('Agent entered error state', null, null, { error: true });
      }
    });
    replaceData(next);
    const updatedText = document.getElementById('updated-text');
    if (updatedText) {
      updatedText.textContent = `Updated ${relTime((state.data || {}).generatedAt || new Date().toISOString())}`;
    }
    updateTitleAndFavicon(((state.data || {}).summary || {}).waiting || 0);
    if (state.view === 'settings') {
      if (settingsNeedsRerender(previousData, state.data)) notifySettingsPoll(previousData, state.data);
    } else if (incomingVersion !== prevVersion) {
      setLastRenderedStatusVersion(incomingVersion);
      const tRender = perfOn ? performance.now() : 0;
      updateActiveView(state.data, { prevData: previousData, statusChanged: true });
      if (perfOn) {
        perf.renderMs = Math.round((performance.now() - tRender) * 100) / 100;
        perf.rendered = true;
      }
    }
    setHealth();
    renderUpdateBadge();
    if (perfOn) {
      const totalMs = Math.round((performance.now() - perf.t0) * 100) / 100;
      const kb = perf.bytes ? ` wire=${Math.round(perf.bytes / 1024)}KB` : '';
      const kStats = getLastKanbanReconcileStats();
      const kanbanPart = kStats && perf.rendered
        ? ` kanban=+${kStats.created}/~${kStats.updated}/-${kStats.removed}`
        : '';
      console.log(
        `[aigon perf] poll total=${totalMs}ms fetch=${perf.fetchMs}ms parse=${perf.parseMs}ms render=${perf.rendered ? `${perf.renderMs}ms` : 'skipped'}${kanbanPart}${kb}`,
      );
    }
  } catch (e) {
    setFailures(state.failures + 1);
    setHealth();
    if (state.serverRestarting) setTimeout(poll, 500);
  }
}

export function startPolling() {
  setPollInterval(POLL_MS);
  setTimeout(poll, 400);
}

export { refreshTimestamps };
