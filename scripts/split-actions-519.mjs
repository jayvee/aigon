#!/usr/bin/env node
/**
 * One-shot mechanical split for F519 — extracts line ranges from actions.js
 * into sibling files. Run from repo root after reviewing line numbers.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const srcPath = path.join(root, 'templates/dashboard/js/actions.js');
const lines = fs.readFileSync(srcPath, 'utf8').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function write(rel, content, banner) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const header = banner ? `// ${banner}\n` : '';
  fs.writeFileSync(full, header + content + '\n');
  console.log('wrote', rel, `(${content.split('\n').length} lines)`);
}

// Classic scripts (preserve globals)
write('templates/dashboard/js/budget-widget.js', slice(2274, 3316), 'F519: agent budget + quota widget (extracted from actions.js)');
write('templates/dashboard/js/matrix-peek.js', slice(3318, 3482), 'F519: agent matrix peek panel (extracted from actions.js)');

const pickerParts = [
  slice(1, 531),
  '',
  slice(1240, 1265),
  '',
  slice(2053, 2098),
  '',
  `// Expose globals for sidebar.js and action modules
if (typeof window !== 'undefined') {
  window.setPickerRecommendation = setPickerRecommendation;
  window.renderPickerRecommendationBanner = renderPickerRecommendationBanner;
  window.renderAgentPickerRows = renderAgentPickerRows;
  window.populateSetAgentPickerReviewerSection = populateSetAgentPickerReviewerSection;
  window.appendTripletSelects = appendTripletSelects;
  window.updateReviewerTripletSelects = updateReviewerTripletSelects;
  window.tripletsToCliArgs = tripletsToCliArgs;
  window.fetchSpecRecommendation = fetchSpecRecommendation;
  window.showConfirm = showConfirm;
  window.showDangerConfirm = showDangerConfirm;
  window.replaceNodeChildren = replaceNodeChildren;
  window.replaceSelectOptions = replaceSelectOptions;
  window.createEl = createEl;
  window.buildAgentCheckRow = buildAgentCheckRow;
  window.buildTripletPickerHeaderRow = buildTripletPickerHeaderRow;
  window.getAutonomousAgentIds = getAutonomousAgentIds;
  window.AIGON_AGENTS = AIGON_AGENTS;
  window.AGENT_DISPLAY_NAMES = AGENT_DISPLAY_NAMES;
  window.AUTONOMOUS_AGENT_IDS = AUTONOMOUS_AGENT_IDS;
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof renderAgentPickerRows === 'function') renderAgentPickerRows();
});`,
];
write('templates/dashboard/js/actions-picker.js', pickerParts.join('\n'), 'F519: triplet picker + shared DOM helpers');

// ESM shared bridge
write('templates/dashboard/js/actions/shared.js', `/** ESM bridge to classic-script picker + utils globals. */
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
`, 'F519: ESM shared bridge');

function wrapModule(name, body, extra = '') {
  return `/** F519 action module: ${name} */
import * as H from './shared.js';

${body}
${extra}
`;
}

write('templates/dashboard/js/actions/nudge.js', wrapModule('nudge', slice(1058, 1238), `
export async function open(ctx) {
  const entityType = ctx.entityType || (ctx.va && ctx.va.action === 'research-nudge' ? 'research' : 'feature');
  showNudgeModal(ctx.feature, ctx.repoPath, ctx.btn, entityType);
}

export function close() {
  hideNudgeModal();
}

export function init() {
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('nudge-modal');
    if (!modal) return;
    document.getElementById('nudge-modal-cancel').onclick = () => hideNudgeModal();
    document.getElementById('nudge-modal-submit').onclick = () => submitNudgeModal();
    modal.onclick = (e) => { if (e.target === e.currentTarget) hideNudgeModal(); };
    const input = document.getElementById('nudge-modal-message');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          submitNudgeModal();
        }
      });
    }
  });
}
`));

write('templates/dashboard/js/actions/close.js', wrapModule('close', slice(1054, 1057) + '\n' + slice(1267, 1375), `
export async function open(ctx) {
  if (ctx.va && ctx.va.action === 'feature-resolve-and-close') {
    const feature = ctx.feature;
    const id = feature.id;
    const agentId = ctx.va.agentId || ((feature.agents || []).find(a => a.id !== 'solo') || {}).id || null;
    const lcf = feature.lastCloseFailure || null;
    await H.requestFeatureOpen(id, agentId, ctx.repoPath, ctx.btn, ctx.pipelineType, 'close-resolve', lcf ? { lastCloseFailure: lcf } : {});
    return;
  }
  const feature = ctx.feature;
  const agents = feature.agents || [];
  const hasMultipleAgents = agents.length > 1 && agents[0].id !== 'solo';
  if (hasMultipleAgents) {
    showCloseModal(feature, ctx.repoPath, ctx.pipelineType);
  } else if (feature.stage === 'in-evaluation') {
    const picked = await H.showAgentPicker(feature.id, feature.name, { single: true, title: 'Pick winner', submitLabel: 'Pick & Close', preselect: feature.winnerAgent, repoPath: ctx.repoPath, taskType: 'evaluate', action: ctx.va.action });
    if (!picked || picked.length === 0) return;
    await H.requestAction('feature-close', [feature.id, picked[0]], ctx.repoPath, ctx.btn);
  } else {
    const agentId = ctx.va.agentId || null;
    await H.requestAction('feature-close', [feature.id, ...(agentId ? [agentId] : [])], ctx.repoPath, ctx.btn);
  }
}

export function close() {
  hideCloseModal();
}

export function init() {
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('close-modal');
    if (!modal) return;
    document.getElementById('close-modal-cancel').onclick = () => hideCloseModal();
    modal.onclick = (e) => { if (e.target === e.currentTarget) hideCloseModal(); };
    document.getElementById('close-modal-submit').onclick = () => submitCloseModal();
    modal.addEventListener('change', (e) => {
      if (e.target.name === 'close-winner') updateAdoptionCheckboxes();
    });
  });
}
`));

write('templates/dashboard/js/actions/schedule-kickoff.js', wrapModule('schedule-kickoff', slice(1410, 1826), `
export async function open(ctx) {
  const entityType = ctx.entityType || (ctx.va && String(ctx.va.action || '').startsWith('research') ? 'research' : 'feature');
  await openScheduleKickoffModal(entityType, ctx.feature, ctx.repoPath, ctx.btn);
}
`));

write('templates/dashboard/js/actions/autonomous.js', wrapModule('autonomous', slice(1061, 1067) + '\n' + slice(1071, 1089) + '\n' + slice(1828, 2272), `
export async function open(ctx) {
  await showAutonomousModal(ctx.feature, ctx.repoPath, ctx.btn);
}

export function close() {
  hideAutonomousModal();
}
`));

write('templates/dashboard/js/actions/set-autonomous.js', wrapModule('set-autonomous', `
async function handleSetActionModule(ctx) {
  const va = ctx.va;
  const setCard = ctx.setCard;
  const repoPath = ctx.repoPath;
  const btn = ctx.btn;
  const slug = String(setCard && setCard.slug || '');
  if (!slug) return;

  switch (va.action) {
    case 'set-autonomous-start': {
      const pick = await H.showAgentPicker(slug, 'set ' + slug, {
        title: 'Choose set agents',
        submitLabel: 'Start set',
        repoPath,
        taskType: 'implement',
        action: va.action,
        collectTriplet: true,
        includeSetReviewer: true,
      });
      if (!pick || !Array.isArray(pick.triplets) || pick.triplets.length === 0) return;
      const triplets = pick.triplets;
      const agentIds = triplets.map(t => t.id);
      const triArgs = H.tripletsToCliArgs(triplets);
      const modelsCsv = (triArgs.find(a => a.startsWith('--models=')) || '').slice('--models='.length) || '';
      const effortsCsv = (triArgs.find(a => a.startsWith('--efforts=')) || '').slice('--efforts='.length) || '';
      const reviewAgent = String(pick.reviewAgent || '').trim();
      const reviewModel = String(pick.reviewModel || '').trim();
      const reviewEffort = String(pick.reviewEffort || '').trim();
      const mergedModels = [modelsCsv, reviewAgent && reviewModel ? (\`\${reviewAgent}=\${reviewModel}\`) : ''].filter(Boolean).join(',');
      const mergedEfforts = [effortsCsv, reviewAgent && reviewEffort ? (\`\${reviewAgent}=\${reviewEffort}\`) : ''].filter(Boolean).join(',');
      const args = [slug, ...agentIds, '--stop-after=close'];
      if (reviewAgent) args.push(\`--review-agent=\${reviewAgent}\`);
      if (mergedModels) args.push(\`--models=\${mergedModels}\`);
      if (mergedEfforts) args.push(\`--efforts=\${mergedEfforts}\`);
      try {
        if (typeof H.fetchBudget === 'function') {
          await H.fetchBudget();
          const warning = H.budgetWarningForAgents([...agentIds, reviewAgent].filter(Boolean));
          if (warning && !window.confirm(warning)) return;
        }
      } catch (_) { /* best-effort */ }
      await H.requestAction('set-autonomous-start', args, repoPath, btn);
      break;
    }
    case 'set-autonomous-reset': {
      const message = (va.metadata && va.metadata.confirmationMessage)
        || ('Reset set "' + slug + '"? This clears the set conductor state file and any in-flight set session.');
      const ok = await H.showDangerConfirm({
        title: 'Reset set "' + slug + '"?',
        message,
        confirmLabel: 'Reset set',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await H.requestAction('set-autonomous-reset', [slug], repoPath, btn);
      break;
    }
    case 'set-prioritise': {
      const msg = (va.metadata && va.metadata.confirmationMessage)
        || ('Prioritise all inbox members of set "' + slug + '" in dependency order?');
      const ok = await H.showConfirm({
        title: 'Prioritise set "' + slug + '"?',
        message: msg,
        confirmLabel: 'Prioritise set',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await H.requestAction('set-prioritise', [slug], repoPath, btn);
      break;
    }
    case 'set-autonomous-stop':
    case 'set-autonomous-resume':
      await H.requestAction(va.action, [slug], repoPath, btn);
      break;
    default:
      await H.requestAction(va.action, [slug], repoPath, btn);
  }
}

export async function open(ctx) {
  await handleSetActionModule(ctx);
}
`));

// start, eval, review, spec-review, pause, delete, reset as handler modules
write('templates/dashboard/js/actions/start.js', wrapModule('start', `import * as H from './shared.js';

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
`));

write('templates/dashboard/js/actions/eval.js', wrapModule('eval', `import * as H from './shared.js';

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
`));

write('templates/dashboard/js/actions/review.js', wrapModule('review', `import * as H from './shared.js';

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
`));

write('templates/dashboard/js/actions/spec-review.js', wrapModule('spec-review', `import * as H from './shared.js';

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
`));

write('templates/dashboard/js/actions/pause.js', wrapModule('pause', `import * as H from './shared.js';

export async function open(ctx) {
  await H.requestAction(ctx.va.action, [ctx.feature.id, ...(ctx.va.agentId ? [ctx.va.agentId] : [])], ctx.repoPath, ctx.btn);
}
`));

write('templates/dashboard/js/actions/delete.js', wrapModule('delete', `import * as H from './shared.js';

export async function open(ctx) {
  const { va, feature, repoPath, btn, pipelineType } = ctx;
  const id = feature.id;
  const deleteCmd = pipelineType === 'research' ? 'research-delete' : 'feature-delete';
  const entityLabel = pipelineType === 'research' ? 'research' : 'feature';
  let msg = va.metadata && va.metadata.confirmationMessage;
  if (msg && entityLabel === 'research' && /\\bfeature\\b/i.test(msg)) msg = null;
  if (!msg) msg = 'Delete this ' + entityLabel + ' spec and its workflow state? This cannot be undone.';
  const ok = await H.showDangerConfirm({
    title: 'Delete ' + entityLabel + ' #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
    message: msg,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel'
  });
  if (!ok) return;
  await H.requestAction(deleteCmd, [id], repoPath, btn);
}
`));

write('templates/dashboard/js/actions/reset.js', wrapModule('reset', `import * as H from './shared.js';

export async function open(ctx) {
  const { va, feature, repoPath, btn, pipelineType } = ctx;
  const id = feature.id;
  if (va.action === 'research-reset') {
    const msg = (va.metadata && va.metadata.confirmationMessage)
      || 'Reset this research topic? This cannot be undone.';
    const ok = await H.showDangerConfirm({
      title: 'Reset research #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
      message: msg,
      confirmLabel: 'Reset research',
      cancelLabel: 'Cancel'
    });
    if (!ok) return;
    await H.requestAction('research-reset', [id], repoPath, btn);
    return;
  }
  const msg = (va.metadata && va.metadata.confirmationMessage)
    || 'Kill tmux sessions, remove the worktree and branch (including any uncommitted work on the branch), clear engine state, and move the spec back to Backlog. This cannot be undone.';
  const ok = await H.showDangerConfirm({
    title: 'Reset feature #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
    message: msg,
    confirmLabel: 'Reset feature',
    cancelLabel: 'Cancel'
  });
  if (!ok) return;
  await H.requestAction('feature-reset', [id], repoPath, btn);
}
`));

console.log('split complete — write new actions.js shell manually');
