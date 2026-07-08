
import * as H from './shared.js';
/** F519 action module: start */

export async function open(ctx) {
  const { va, feature, repoPath, btn, pipelineType } = ctx;
  const id = feature.id;
  function pCmd(action) {
    const prefix = pipelineType === 'research' ? 'research' : pipelineType === 'feedback' ? 'feedback' : 'feature';
    return prefix + '-' + action;
  }
  if (va.action === 'feature-autopilot') {
    const recommendation = await H.fetchSpecRecommendation('feature', id, repoPath);
    const triplets = await H.showAgentPicker(id, feature.name, { title: 'Select Autopilot Agents', submitLabel: 'Autopilot', repoPath, taskType: 'implement', action: va.action, collectTriplet: true, recommendation });
    if (!triplets) return;
    if (triplets.length < 2) { H.showToast('Select at least 2 agents for autopilot'); return; }
    const extraArgs = H.tripletsToCliArgs(triplets);
    const agentIds = triplets.map(t => t.id);
    await H.requestAction('feature-autopilot', [id, ...agentIds, ...extraArgs, '--auto-eval'], repoPath, btn);
    return;
  }
  const recEntity = va.action === 'research-start' ? 'research' : 'feature';
  const recommendation = await H.fetchSpecRecommendation(recEntity, id, repoPath);
  const triplets = await H.showAgentPicker(id, feature.name, { repoPath, taskType: 'implement', action: va.action, collectTriplet: true, recommendation });
  if (!triplets) return;
  const agentIds = triplets.map(t => t.id);
  try {
    if (typeof H.fetchBudget === 'function') {
      await H.fetchBudget();
      const warning = H.budgetWarningForAgents(agentIds);
      if (warning && !window.confirm(warning)) return;
    }
  } catch (_) { /* best-effort */ }
  const extraArgs = H.tripletsToCliArgs(triplets);
  await H.requestAction(pCmd('start'), [id, ...agentIds, ...extraArgs], repoPath, btn);
}



