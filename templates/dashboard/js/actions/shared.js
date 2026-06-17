// F519: ESM shared bridge
/** ESM bridge to classic-script picker + utils globals. */
function g(name) {
  const fn = typeof window !== 'undefined' ? window[name] : undefined;
  if (typeof fn !== 'function' && name !== 'AIGON_AGENTS' && name !== 'AGENT_DISPLAY_NAMES' && name !== 'AUTONOMOUS_AGENT_IDS') {
    return undefined;
  }
  return fn;
}

export const escHtml = (...args) => window.escHtml(...args);
export const showToast = (...args) => window.showToast(...args);
export const requestAction = (...args) => window.requestAction(...args);
export const requestFeatureOpen = (...args) => window.requestFeatureOpen(...args);
export const requestSpecReviewLaunch = (...args) => window.requestSpecReviewLaunch(...args);
export const requestRefresh = (...args) => window.requestRefresh(...args);
export const requestFeatureAutonomousRun = (...args) => window.requestFeatureAutonomousRun(...args);
export const requestFeatureNudge = (...args) => window.requestFeatureNudge(...args);
export const requestResearchNudge = (...args) => window.requestResearchNudge(...args);
export const fetchAgentModels = (...args) => window.fetchAgentModels(...args);
export const formatFeatureIdForDisplay = (...args) => window.formatFeatureIdForDisplay(...args);
export const showAgentPicker = (...args) => window.showAgentPicker(...args);
export const fetchBudget = (...args) => window.fetchBudget(...args);
export const budgetWarningForAgents = (...args) => window.budgetWarningForAgents(...args);

export const setPickerRecommendation = (...args) => g('setPickerRecommendation')(...args);
export const renderPickerRecommendationBanner = (...args) => g('renderPickerRecommendationBanner')(...args);
export const renderAgentPickerRows = (...args) => g('renderAgentPickerRows')(...args);
export const appendTripletSelects = (...args) => g('appendTripletSelects')(...args);
export const updateReviewerTripletSelects = (...args) => g('updateReviewerTripletSelects')(...args);
export const tripletsToCliArgs = (...args) => g('tripletsToCliArgs')(...args);
export const fetchSpecRecommendation = (...args) => g('fetchSpecRecommendation')(...args);
export const showConfirm = (...args) => g('showConfirm')(...args);
export const showDangerConfirm = (...args) => g('showDangerConfirm')(...args);
export const replaceNodeChildren = (...args) => g('replaceNodeChildren')(...args);
export const replaceSelectOptions = (...args) => g('replaceSelectOptions')(...args);
export const createEl = (...args) => g('createEl')(...args);
export const buildAgentCheckRow = (...args) => g('buildAgentCheckRow')(...args);
export const buildTripletPickerHeaderRow = (...args) => g('buildTripletPickerHeaderRow')(...args);
export const getAutonomousAgentIds = (...args) => g('getAutonomousAgentIds')(...args);

export function getAgents() {
  return window.AIGON_AGENTS || [];
}
export function getAgentDisplayNames() {
  return window.AGENT_DISPLAY_NAMES || {};
}
export function getAutonomousAgentIdsList() {
  return window.AUTONOMOUS_AGENT_IDS || [];
}

