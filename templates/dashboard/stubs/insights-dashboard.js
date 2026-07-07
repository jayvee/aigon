'use strict';

const proMissing = `export function renderInsightsDashboard() {
  var c = document.getElementById('insights-view');
  if (c) c.innerHTML = '<div class="stats-empty-msg" style="text-align:center;padding:40px 20px">' +
    '<div style="font-size:18px;font-weight:600;margin-bottom:8px">Insights <span style="font-size:11px;opacity:0.75">(Pro — coming later)</span></div>' +
    '<div style="color:var(--text-secondary);margin-bottom:16px">Quality metrics, cost trends, autonomy signals, and AI coaching.</div>' +
    '<div style="color:var(--text-tertiary);font-size:12px;margin-top:12px">Pro is in development and not yet available for purchase. Free alternative: <code>aigon board</code>, <code>aigon commits</code>, <code>aigon feature-status</code>.</div>' +
    '</div>';
}
Object.assign(globalThis, { renderInsightsDashboard });`;
const proUnavailable = proMissing;

module.exports = {
    proMissing,
    proUnavailable,
};
