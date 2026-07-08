
import * as H from './shared.js';
/** F519 action module: eval */

function getLaunchMode(action) {
  if (action === 'feature-eval' || action === 'research-eval') return 'eval';
  return 'do';
}

export async function open(ctx) {
  const { va, feature, repoPath, btn, pipelineType } = ctx;
  const id = feature.id;
  const implAgents = (feature.agents || []).map(a => a.id);
  const picked = await H.showAgentPicker(id, feature.name, {
    single: true,
    collectTriplet: true,
    title: 'Choose evaluation agent',
    submitLabel: 'Run Evaluation',
    implementingAgents: implAgents,
    repoPath,
    taskType: 'evaluate',
    action: va.action
  });
  if (!picked || picked.length === 0) return;
  const t = picked[0];
  const launchOpts = {};
  if (t.model) launchOpts.model = t.model;
  if (t.effort) launchOpts.effort = t.effort;
  const setupAction = va.action === 'research-eval' ? 'research-eval' : 'feature-eval';
  if (setupAction && feature.stage !== 'in-evaluation') {
    await H.requestAction(setupAction, [id, '--setup-only'], repoPath, btn);
  }
  await H.requestFeatureOpen(id, t.id, repoPath, null, pipelineType, getLaunchMode(va.action), launchOpts);
}



