/* dashboard-esm-processed */
/** Agent model map from /api/settings — shared by sidebar picker and actions-picker. */

import { agents } from './injected.js';

function isKnownAgentModelValue(agentId, value) {
  const modelValue = value == null ? '' : String(value);
  if (!modelValue) return false;
  const agent = agents.find((a) => a.id === agentId);
  const modelOptions = agent && Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  const concreteValues = modelOptions
    .map((opt) => (!opt || opt.value == null) ? null : String(opt.value))
    .filter(Boolean);
  return concreteValues.length === 0 || concreteValues.includes(modelValue);
}

export function fetchAgentModels(repoPath) {
  const params = new URLSearchParams();
  if (repoPath) params.set('repoPath', repoPath);
  else params.set('globalOnly', '1');
  const query = params.toString();
  return fetch(`/api/settings?${query}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((data) => {
      const agentModelMap = {};
      const settings = (data && data.settings) || [];
      settings.forEach((def) => {
        const m = String(def.key || '').match(/^agents\.(\w+)\.(research|implement|evaluate|review)\.model$/);
        if (!m) return;
        const agentId = m[1];
        const taskType = m[2];
        if (!agentModelMap[agentId]) agentModelMap[agentId] = {};
        if (def.effectiveValue && isKnownAgentModelValue(agentId, def.effectiveValue)) {
          agentModelMap[agentId][taskType] = def.effectiveValue;
        }
      });
      return agentModelMap;
    })
    .catch(() => ({}));
}
