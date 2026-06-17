/** F519 action module: review */
import * as H from './shared.js';

function getLaunchMode(action) {
  if (action === 'feature-code-review' || action === 'research-review') return 'review';
  return 'do';
}

export async function open(ctx) {
  const { va, feature, repoPath, btn, pipelineType } = ctx;
  const id = feature.id;
  const implAgents = (feature.agents || []).map(a => a.id);
  const picked = await H.showAgentPicker(id, feature.name, {
    single: true,
    collectTriplet: true,
    title: 'Choose agent for ' + (va.label || 'review'),
    submitLabel: va.label || 'Review',
    implementingAgents: implAgents,
    repoPath,
    taskType: 'review',
    action: va.action
  });
  if (!picked || picked.length === 0) return;
  const t = picked[0];
  const launchOpts = {};
  if (t.model) launchOpts.model = t.model;
  if (t.effort) launchOpts.effort = t.effort;
  await H.requestFeatureOpen(id, t.id, repoPath, null, pipelineType, getLaunchMode(va.action), launchOpts);
}



