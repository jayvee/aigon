// F519/F641: ESM shared imports for lazy action modules (no window bridges).
import {
  AGENT_DISPLAY_NAMES,
  AIGON_AGENTS,
  AUTONOMOUS_AGENT_IDS,
  appendTripletSelects,
  buildAgentCheckRow,
  buildTripletPickerHeaderRow,
  createEl,
  fetchSpecRecommendation,
  getAutonomousAgentIds,
  renderAgentPickerRows,
  renderPickerRecommendationBanner,
  replaceNodeChildren,
  replaceSelectOptions,
  setPickerRecommendation,
  showConfirm,
  showDangerConfirm,
  tripletsToCliArgs,
  updateReviewerTripletSelects,
} from '../actions-picker.js';
import {
  requestAction,
  requestFeatureAutonomousRun,
  requestFeatureNudge,
  requestFeatureOpen,
  requestRefresh,
  requestResearchNudge,
  requestSpecReviewLaunch,
} from '../api.js';
import { fetchBudget, budgetWarningForAgents } from '../budget-widget.js';
import { fetchAgentModels } from '../agent-models.js';
import { showAgentPicker } from '../sidebar.js';
import { escHtml, formatFeatureIdForDisplay, showToast } from '../utils.js';

export {
  AGENT_DISPLAY_NAMES,
  AIGON_AGENTS,
  AUTONOMOUS_AGENT_IDS,
  appendTripletSelects,
  budgetWarningForAgents,
  buildAgentCheckRow,
  buildTripletPickerHeaderRow,
  createEl,
  escHtml,
  fetchAgentModels,
  fetchBudget,
  fetchSpecRecommendation,
  formatFeatureIdForDisplay,
  getAutonomousAgentIds,
  renderAgentPickerRows,
  renderPickerRecommendationBanner,
  replaceNodeChildren,
  replaceSelectOptions,
  requestAction,
  requestFeatureAutonomousRun,
  requestFeatureNudge,
  requestFeatureOpen,
  requestRefresh,
  requestResearchNudge,
  requestSpecReviewLaunch,
  setPickerRecommendation,
  showAgentPicker,
  showConfirm,
  showDangerConfirm,
  showToast,
  tripletsToCliArgs,
  updateReviewerTripletSelects,
};

export function getAgents() {
  return AIGON_AGENTS;
}

export function getAgentDisplayNames() {
  return AGENT_DISPLAY_NAMES;
}

export function getAutonomousAgentIdsList() {
  return AUTONOMOUS_AGENT_IDS;
}
