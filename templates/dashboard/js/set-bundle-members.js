/* dashboard-esm-processed */

// Queued set members are compact clickable identity tiles. Active members
// retain their full contract card, while a current member already embedded in
// the set header is not rendered a second time.

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

export function shouldSkipSetStackMember(feature, roll) {
  if (!feature || !roll || !roll.currentFeatureContract || !roll.currentFeature) return false;
  const currentId = roll.currentFeature.id;
  return currentId != null && String(feature.id) === String(currentId);
}

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
