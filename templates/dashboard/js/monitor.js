/* dashboard-esm-processed */

import { state } from './state.js';

function updateTitleAndFavicon(waiting) {
  document.title = waiting > 0 ? '(' + waiting + ') Aigon Dashboard' : 'Aigon Dashboard';
  const link = document.querySelector('link[rel="icon"]') || (() => { const x = document.createElement('link'); x.rel = 'icon'; document.head.appendChild(x); return x; })();
  if (!waiting) { link.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22></svg>'; return; }
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111113'; ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(waiting > 99 ? '99+' : waiting), 16, 16);
  link.href = c.toDataURL('image/png');
}

function setHealth() {
  const dot = document.getElementById('health-dot');
  const text = document.getElementById('health-text');
  if (state.failures === 0) {
    dot.style.background = '#22c55e';
    if (state.serverRestarting) hideServerRestartBanner();
    text.textContent = state.sseConnected ? 'Connected (live)' : 'Connected';
    return;
  }
  if (state.failures < 3) { dot.style.background = '#f59e0b'; text.textContent = 'Reconnecting...'; return; }
  dot.style.background = '#ef4444'; text.textContent = 'Disconnected';
}

function renderUpdateBadge() {
  const pill = document.getElementById('update-pill');
  if (!pill) return;
  const uc = (state.data || {}).updateCheck;
  if (!uc || uc.state === 'latest' || uc.state === 'unavailable') {
    pill.setAttribute('data-hidden', '');
    return;
  }
  const version = uc.latestStable || uc.latestNext || '';
  const label = uc.state === 'prerelease-available' ? `↑ ${version} (next)` : `↑ ${version}`;
  pill.textContent = label;
  pill.title = `Update available — run: ${uc.upgradeCommand}`;
  pill.removeAttribute('data-hidden');
}

function showServerRestartBanner() {
  state.serverRestarting = true;
  let el = document.getElementById('server-restart-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'server-restart-banner';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 14px;background:#1e3a8a;color:#fff;text-align:center;font-size:13px;z-index:9999;box-shadow:0 2px 6px rgba(0,0,0,.25);';
    el.innerHTML = '<span class="monitor-reload-spin"></span>Reloading backend…';
    if (!document.getElementById('server-restart-banner-style')) {
      const style = document.createElement('style');
      style.id = 'server-restart-banner-style';
      style.textContent = '@keyframes spin{to{transform:rotate(360deg);}}';
      document.head.appendChild(style);
    }
    document.body.appendChild(el);
  }
}

function hideServerRestartBanner() {
  state.serverRestarting = false;
  const el = document.getElementById('server-restart-banner');
  if (el) el.remove();
}

function updateViewTabs() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-view') === state.view);
  });
}

function getVisibleRepos(data) {
  if (!data || !data.repos) return [];
  const hidden = state.hiddenRepos || [];
  if (state.selectedRepo === 'all') return data.repos.filter(r => !hidden.includes(r.path));
  return data.repos.filter(r => r.path === state.selectedRepo);
}

export {
  getVisibleRepos,
  renderUpdateBadge,
  setHealth,
  showServerRestartBanner,
  updateTitleAndFavicon,
  updateViewTabs,
};
