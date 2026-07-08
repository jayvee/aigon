/* dashboard-esm-processed */
/** Cycle-break hooks — poll/settings/api wire at init without import cycles. */

let refreshHandler = null;
let settingsPollHandler = null;
let renderHandler = null;

export function registerRefreshHandler(fn) {
  refreshHandler = fn;
}

export function registerRenderHandler(fn) {
  renderHandler = fn;
}

export function notifyDataRefreshComplete() {
  if (typeof renderHandler === 'function') renderHandler();
}

export function triggerDashboardRefresh(repoPath) {
  if (typeof refreshHandler === 'function') return refreshHandler(repoPath);
  return Promise.resolve();
}

export function registerSettingsPollHandler(fn) {
  settingsPollHandler = fn;
}

export function notifySettingsPoll(previousData, nextData) {
  if (typeof settingsPollHandler === 'function') settingsPollHandler(previousData, nextData);
}
