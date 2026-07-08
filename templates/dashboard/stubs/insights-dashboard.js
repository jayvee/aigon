'use strict';

const proMissing = `export function renderInsightsDashboard() {
  var c = document.getElementById('insights-view');
  if (c) c.innerHTML = '<div class="stats-empty-msg pro-empty-centered">' +
    '<div class="pro-empty-title--lg">Insights <span class="pro-tab-badge--md">(Pro — coming later)</span></div>' +
    '<div class="pro-empty-body pro-empty-body--spaced">Quality metrics, cost trends, autonomy signals, and AI coaching.</div>' +
    '<div class="pro-empty-foot">Pro is in development and not yet available for purchase. Free alternative: <code>aigon board</code>, <code>aigon commits</code>, <code>aigon feature-status</code>.</div>' +
    '</div>';
}
Object.assign(globalThis, { renderInsightsDashboard });`;
const proUnavailable = proMissing;

module.exports = {
    proMissing,
    proUnavailable,
};
