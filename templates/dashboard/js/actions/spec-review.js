/** F519 action module: spec-review */
import * as H from './shared.js';

const ENDPOINTS = {
  'feature-spec-review': 'feature-spec-review',
  'feature-spec-revise': 'feature-spec-revise',
  'research-spec-review': 'research-spec-review',
  'research-spec-revise': 'research-spec-revise',
};

const TITLES = {
  'feature-spec-review': ['Choose spec reviewer', 'Review Spec'],
  'feature-spec-revise': ['Choose author agent', 'Revise Spec'],
  'research-spec-review': ['Choose spec reviewer', 'Review Spec'],
  'research-spec-revise': ['Choose author agent', 'Revise Spec'],
};

export async function open(ctx) {
  const { va, feature, repoPath, btn } = ctx;
  const id = feature.id;
  const endpoint = ENDPOINTS[va.action];
  const [title, submitLabel] = TITLES[va.action] || ['Choose agent', 'Go'];
  const picked = await H.showAgentPicker(id, feature.name, {
    single: true,
    collectTriplet: true,
    title,
    submitLabel,
    preselect: va.action.includes('revise') ? (feature.authorAgentId || null) : null,
    repoPath,
    taskType: 'review',
    action: va.action
  });
  if (!picked || picked.length === 0) return;
  const t = picked[0];
  const launchOpts = {};
  if (t.model) launchOpts.model = t.model;
  if (t.effort) launchOpts.effort = t.effort;
  await H.requestSpecReviewLaunch(endpoint, id, t.id, repoPath, btn, launchOpts);
  await H.requestRefresh();
}



