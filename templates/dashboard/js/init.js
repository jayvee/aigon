/* dashboard-esm-processed */

import { POLL_MS, TS_MS, state } from './state.js';
import { connectLive } from './live.js';
import { loadNotifications, poll, refreshTimestamps, setPollInterval, startPolling } from './poll.js';
import {
  registerRefreshHandler,
  registerRenderHandler,
  registerSettingsPollHandler,
} from './poll-hooks.js';
import { requestRefresh } from './api.js';
import { syncDashboardHiddenRepos } from './preferences-sync.js';
import { renderSettings } from './settings.js';
import { toggleSidebarHidden } from './store.js';
import { applyView, initViewShell, settingsNeedsRerender } from './view-registry.js';
import { escHtml, relTime } from './utils.js';

registerRefreshHandler(requestRefresh);
registerRenderHandler(() => applyView());
registerSettingsPollHandler((previousData, nextData) => {
  if (settingsNeedsRerender(previousData, nextData)) renderSettings();
});

initViewShell();
syncDashboardHiddenRepos(state.hiddenRepos || []);

fetch('/api/docs-url').then((r) => r.json()).then(({ url }) => {
  const docsLink = document.getElementById('docs-link');
  if (!docsLink) return;
  docsLink.href = url;
  docsLink.title = url.startsWith('http://localhost') ? 'Open docs (local)' : 'Open Aigon docs';
}).catch(() => {});

document.getElementById('refresh-btn').onclick = requestRefresh;
document.getElementById('sidebar-toggle-btn').onclick = () => {
  toggleSidebarHidden();
  applyView();
};
setInterval(refreshTimestamps, TS_MS);
startPolling();
connectLive();

(() => {
  const sidebar = document.getElementById('repo-sidebar');
  const handle = document.getElementById('sidebar-resize');
  const saved = localStorage.getItem('aigon-sidebar-width');
  if (saved) sidebar.style.setProperty('--sidebar-width', `${saved}px`);
  let startX; let startW;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    handle.classList.add('active');
    const onMove = (ev) => {
      const w = Math.min(400, Math.max(140, startW + ev.clientX - startX));
      sidebar.style.setProperty('--sidebar-width', `${w}px`);
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
  error: 'Error',
};

function relTimeShort(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderNotifList(events) {
  if (!events || events.length === 0) {
    notifList.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  notifList.innerHTML = '';
  [...events].reverse().forEach((ev) => {
    const item = document.createElement('div');
    item.className = `notif-item${ev.read ? '' : ' unread'}`;
    item.style.cursor = 'pointer';
    const typeLabel = NOTIF_TYPE_LABELS_DISPLAY[ev.type] || ev.type;
    item.innerHTML =
      `<div class="notif-item-type ${ev.type}">${escHtml(typeLabel)}</div>` +
      `<div class="notif-item-msg">${escHtml(ev.message)}</div>` +
      `<div class="notif-item-time">${relTimeShort(ev.timestamp)}</div>`;
    item.onclick = () => { closeNotifDropdown(); };
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

async function openNotifDropdown() {
  const events = await loadNotifications();
  renderNotifList(events);
  notifDropdown.classList.add('open');
  notifOverlay.classList.add('open');
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

loadNotifications();

export { poll, refreshTimestamps, setPollInterval };
