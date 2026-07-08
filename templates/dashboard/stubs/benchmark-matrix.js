'use strict';

const proMissing = `export const AigonProBenchmarkMatrix = { mount: function (section) {
  var w = document.createElement('div');
  w.className = 'matrix-section';
  w.innerHTML = '<div class="amp-empty amp-empty-centered">' +
    '<div class="pro-empty-title">Performance benchmarks <span class="pro-tab-badge">(Pro)</span></div>' +
    '<div class="pro-empty-body">Pro is active but <code>dashboard/benchmark-matrix.js</code> is missing from your <code>@senlabsai/aigon-pro</code> install. Run <code>npm update -g @senlabsai/aigon-pro</code> to fix.</div>' +
    '</div>';
  section.appendChild(w);
}};
Object.assign(globalThis, { AigonProBenchmarkMatrix });`;
const proUnavailable = `export const AigonProBenchmarkMatrix = { mount: function (section) {
  var w = document.createElement('div');
  w.className = 'matrix-section';
  w.innerHTML = '<div class="settings-empty">Install <code>@senlabsai/aigon-pro</code> and restart the dashboard to load Pro benchmark results here.</div>';
  section.appendChild(w);
}};
Object.assign(globalThis, { AigonProBenchmarkMatrix });`;

module.exports = {
    proMissing,
    proUnavailable,
};
