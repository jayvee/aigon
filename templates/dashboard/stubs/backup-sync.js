'use strict';

const proMissing = `export function renderBackupSync() {
  var c = document.getElementById('backup-sync-view');
  if (!c) return;
  c.innerHTML = '<div class="amp-empty pro-empty-centered">' +
    '<div class="pro-empty-title">Aigon Sync <span class="pro-tab-badge">(Pro)</span></div>' +
    '<div class="pro-empty-body">Pro is active but the Aigon Sync dashboard script is missing from your <code>@senlabsai/aigon-pro</code> install. ' +
    'Run <code>npm update -g @senlabsai/aigon-pro</code> to fix. ' +
    'Manual backup does not require Pro.</div>' +
    '</div>';
}
Object.assign(globalThis, { renderBackupSync });`;
const proUnavailable = `export function renderBackupSync() {
  var c = document.getElementById('backup-sync-view');
  if (!c) return;
  c.innerHTML = '<div class="amp-empty pro-empty-centered">' +
    '<div class="pro-empty-title">Aigon Sync <span class="pro-tab-badge">(Pro)</span></div>' +
    '<div class="pro-empty-body">Install <code>@senlabsai/aigon-pro</code> for remote vault sync. Manual backup does not require Pro.</div>' +
    '</div>';
}
Object.assign(globalThis, { renderBackupSync });`;

module.exports = {
    proMissing,
    proUnavailable,
};
