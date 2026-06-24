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

function resolveAuthor(feature) {
  if (feature && feature.specAuthor && feature.specAuthor.agentId) {
    return feature.specAuthor;
  }
  if (feature && feature.authorAgentId) {
    return { agentId: feature.authorAgentId, model: null, effort: null, authoredAt: null };
  }
  return null;
}

export async function open(ctx) {
  const { va, feature, repoPath, btn } = ctx;
  const id = feature.id;
  const endpoint = ENDPOINTS[va.action];
  const [title, submitLabel] = TITLES[va.action] || ['Choose agent', 'Go'];
  const isRevise = va.action.includes('revise');
  const author = resolveAuthor(feature);
  const authorId = author && author.agentId ? author.agentId : null;
  const recommendation = isRevise && authorId ? {
    specAuthorPreselect: true,
    agents: {
      [authorId]: {
        model: author.model || null,
        effort: author.effort || null,
      },
    },
  } : null;
  const picked = await H.showAgentPicker(id, feature.name, {
    single: true,
    collectTriplet: true,
    title,
    submitLabel,
    preselect: isRevise ? authorId : null,
    highlightAuthorId: !isRevise ? authorId : null,
    highlightAuthor: !isRevise ? author : null,
    recommendation,
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
