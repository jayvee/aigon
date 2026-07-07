'use strict';

const proMissing = `export const AigonProBenchmarkMatrix = { mount: function (section) {
  var w = document.createElement('div');
  w.className = 'matrix-section';
  w.innerHTML = '<div class="amp-empty" style="padding:20px 0;text-align:center">' +
    '<div style="font-size:15px;font-weight:600;margin-bottom:8px">Performance benchmarks <span style="font-size:10px;opacity:0.7">(Pro)</span></div>' +
    '<div style="color:var(--text-secondary);font-size:12px">Pro is active but <code>dashboard/benchmark-matrix.js</code> is missing from your <code>@senlabsai/aigon-pro</code> install. Run <code>npm update -g @senlabsai/aigon-pro</code> to fix.</div>' +
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
