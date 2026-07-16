/* dashboard-esm-processed */

// Set bundle stack helpers: clickable member cards live in kanban-set-stack.
// Pre-start members render as identity-only tiles (click opens spec details);
// active members keep full status. The set header's flat member list is
// suppressed so members are not shown twice.

const PRE_START_STAGES = new Set(['inbox', 'backlog', 'done']);
const ACTIVE_STAGES = new Set(['in-progress', 'in-evaluation', 'paused']);
const ACTIVE_LIFECYCLES = new Set([
  'implementing',
  'code_review_in_progress',
  'code_revision_in_progress',
  'spec_review_in_progress',
  'spec_revision_in_progress',
  'evaluating',
  'closing',
  'close_recovery_in_progress',
]);

function memberLifecycle(feature) {
  return feature.currentSpecState
    || (feature.uiContract && feature.uiContract.state && feature.uiContract.state.lifecycle)
    || null;
}

function isAutonomousFocusMember(feature, roll) {
  const auto = roll && roll.autonomous;
  if (!auto) return false;
  const fid = String(feature.id || '');
  if (!fid) return false;
  if (auto.currentFeature && String(auto.currentFeature) === fid) return true;
  if (auto.failedFeature && String(auto.failedFeature) === fid) return true;
  return Array.isArray(auto.failed) && auto.failed.some(id => String(id) === fid);
}

function hasActiveAgentRow(feature) {
  return Array.isArray(feature.agents) && feature.agents.some((agent) => {
    if (!agent || !agent.status) return false;
    const status = String(agent.status);
    return status !== 'waiting' && status !== 'complete' && status !== 'completed' && status !== 'ready';
  });
}

/**
 * Stack members that are already embedded in the set contract header should not
 * duplicate as a second full card beneath it.
 */
export function shouldSkipSetStackMember(feature, roll) {
  if (!feature || !roll || !roll.currentFeatureContract || !roll.currentFeature) return false;
  const currentId = roll.currentFeature.id;
  return currentId != null && String(feature.id) === String(currentId);
}

/**
 * Identity-only stack tile: clickable for spec details, no status chrome.
 */
export function isSetStackIdleMember(feature, roll) {
  if (!feature) return false;
  if (shouldSkipSetStackMember(feature, roll)) return false;
  if (ACTIVE_STAGES.has(String(feature.stage || ''))) return false;
  if (isAutonomousFocusMember(feature, roll)) return false;
  const lifecycle = memberLifecycle(feature);
  if (lifecycle && ACTIVE_LIFECYCLES.has(String(lifecycle))) return false;
  if (hasActiveAgentRow(feature)) return false;
  return PRE_START_STAGES.has(String(feature.stage || '')) || String(feature.stage || '') === '';
}

export function filterSetStackMembers(members, roll) {
  return (Array.isArray(members) ? members : [])
    .filter(member => !shouldSkipSetStackMember(member, roll));
}
