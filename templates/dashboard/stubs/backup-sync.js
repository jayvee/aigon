'use strict';

const proMissing = `export function renderBackupSync() {
  var c = document.getElementById('backup-sync-view');
  if (!c) return;
  c.innerHTML = '<div class="amp-empty" style="padding:28px 0;text-align:center">' +
    '<div style="font-size:15px;font-weight:600;margin-bottom:8px">Aigon Sync <span style="font-size:10px;opacity:0.7">(Pro)</span></div>' +
    '<div style="color:var(--text-secondary);font-size:12px">Pro is active but the Aigon Sync dashboard script is missing from your <code>@senlabsai/aigon-pro</code> install. ' +
    'Run <code>npm update -g @senlabsai/aigon-pro</code> to fix. ' +
    'Manual backup does not require Pro.</div>' +
    '</div>';
}
Object.assign(globalThis, { renderBackupSync });`;
const proUnavailable = `export function renderBackupSync() {
  var c = document.getElementById('backup-sync-view');
  if (!c) return;
  c.innerHTML = '<div class="amp-empty" style="padding:28px 0;text-align:center">' +
    '<div style="font-size:15px;font-weight:600;margin-bottom:8px">Aigon Sync <span style="font-size:10px;opacity:0.7">(Pro)</span></div>' +
    '<div style="color:var(--text-secondary);font-size:12px">Install <code>@senlabsai/aigon-pro</code> for remote vault sync. Manual backup does not require Pro.</div>' +
    '</div>';
}
Object.assign(globalThis, { renderBackupSync });`;

module.exports = {
    proMissing,
    proUnavailable,
};
