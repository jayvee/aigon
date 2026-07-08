
import { defaultAgent } from '../injected.js';
import { state } from '../state.js';
import * as H from './shared.js';
/** F519 action module: autonomous */

function budgetNotice() {
  if (typeof window.updateAutonomousBudgetNotice === 'function') window.updateAutonomousBudgetNotice();
}

let autonomousModalFeature = null;
let autonomousModalRepoPath = null;
let autonomousModalBtn = null;
let autonomousModalModels = null;
let autonomousModalWorkflowSlug = '';
let autonomousModalSubmitting = false;
function setAutonomousSubmitLoading(loading) {
  const btn = document.getElementById('autonomous-modal-submit');
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '';
    const spinner = document.createElement('span');
    spinner.className = 'run-next-spinner';
    btn.appendChild(spinner);
    btn.appendChild(document.createTextNode('Starting…'));
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = btn.dataset.originalLabel || 'Start Autonomously';
    delete btn.dataset.originalLabel;
  }
}
async function showAutonomousModal(feature, repoPath, btn) {
  autonomousModalFeature = feature;
  autonomousModalRepoPath = repoPath;
  autonomousModalBtn = btn || null;
  // F454: do NOT await /api/agent-models here. Skeleton rows are built from
  // window.AIGON_AGENTS[i].defaultImplementModel (resolved at server bootstrap from
  // project → global → built-in defaults). This makes first paint immediate.
  autonomousModalModels = null;

  const desc = document.getElementById('autonomous-modal-desc');
  const checks = document.getElementById('autonomous-agent-checks');
  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  const modal = document.getElementById('autonomous-modal');
  if (!desc || !checks || !evalSelect || !reviewSelect || !stopAfter || !modal) return;

  // Build the skeleton synchronously so we can show the modal immediately.
  desc.textContent = '';
  desc.appendChild(document.createTextNode('#' + feature.id + ' ' + (feature.name || '')));
  if (feature.set) {
    desc.appendChild(document.createElement('br'));
    const hint = document.createElement('span');
    hint.style.cssText = 'color:var(--text-secondary);font-size:12px;line-height:1.45';
    hint.textContent = 'Set "' + String(feature.set) + '": this workflow runs this feature only. To run every set member in order, use "Start set autonomously" on the set card (Monitor) or the set row in Pipeline (Group by Set).';
    desc.appendChild(hint);
  }
  const autoRows = H.getAutonomousAgentIdsList().map((agentId) => {
    const displayName = H.getAgentDisplayNames()[agentId] || agentId;
    const agent = H.getAgents().find((a) => a.id === agentId) || { id: agentId, modelOptions: [], effortOptions: [] };
    const modelName = agent.defaultImplementModel || '';
    const row = H.buildAgentCheckRow({
      value: agentId,
      checked: agentId === (defaultAgent || 'cc'),
      label: agentId,
      hint: displayName,
      tripletGrid: true,
      tripletCheckboxIdPrefix: 'autonomous',
    });
    row.dataset.agentId = agentId;
    H.appendTripletSelects(row, agent);
    const cfg = row.querySelector('.agent-check-config-model');
    if (cfg) cfg.textContent = modelName || '';
    return row;
  });
  H.replaceNodeChildren(checks, [H.buildTripletPickerHeaderRow(), ...autoRows]);
  checks.classList.add('agent-checks-triplet');

  stopAfter.value = 'close';
  updateAutonomousModeControls();

  // First paint — show the modal immediately. Banner + workflow dropdown
  // hydrate in the background.
  modal.style.display = 'flex';

  // F454: cache-hit budget read; only kick a refresh if the cached entry is
  // older than 5 minutes (or absent entirely). Mid-run refreshes are not
  // critical to the "Start Autonomously" flow — the budget widget already
  // refreshes on its own cadence.
  const BUDGET_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
  H.fetchBudget(false).then(cache => {
    let newest = 0;
    if (cache && typeof cache === 'object') {
      Object.values(cache).forEach(v => {
        const polled = v && v.polled_at ? new Date(v.polled_at).getTime() : 0;
        if (polled > newest) newest = polled;
      });
    }
    if (!newest || (Date.now() - newest) > BUDGET_REFRESH_THRESHOLD_MS) {
      H.fetchBudget(true).then(() => budgetNotice()).catch(() => {});
    }
    budgetNotice();
  }).catch(() => { budgetNotice(); });

  // Hydrate banner + workflow dropdown in parallel; each updates the modal
  // when it resolves so the user sees progressive completion.
  Promise.all([
    H.fetchSpecRecommendation('feature', String(feature.id), repoPath).catch(() => null),
    populateAutonomousWorkflowDropdown(repoPath).catch(() => undefined),
  ]).then(([autonomousRec]) => {
    H.setPickerRecommendation(autonomousRec || null);
    H.renderPickerRecommendationBanner(autonomousRec || null, 'autonomous-picker-recommendation');
  });
}

let autonomousModalWorkflows = [];

async function populateAutonomousWorkflowDropdown(repoPath) {
  const select = document.getElementById('autonomous-workflow');
  if (!select) return;
  try {
    const q = repoPath ? '?repo=' + encodeURIComponent(repoPath) : '';
    const res = await fetch('/api/workflows' + q, { cache: 'no-store' });
    const data = res.ok ? await res.json() : { workflows: [] };
    autonomousModalWorkflows = Array.isArray(data.workflows) ? data.workflows : [];
  } catch (_) {
    autonomousModalWorkflows = [];
  }
  const options = [{ value: '', label: '(custom — configure below)' }];
  autonomousModalWorkflows.forEach(def => {
    const badge = def.source === 'built-in' ? ' ★' : (def.source === 'global' ? ' [global]' : '');
    options.push({ value: def.slug, label: def.slug + badge + ' — ' + def.label });
  });
  H.replaceSelectOptions(select, options);
  select.value = '';
  const descEl = document.getElementById('autonomous-workflow-desc');
  if (descEl) descEl.textContent = '';
}

function applyAutonomousWorkflow(slug) {
  autonomousModalWorkflowSlug = slug;
  const def = autonomousModalWorkflows.find(d => d.slug === slug);
  const descEl = document.getElementById('autonomous-workflow-desc');
  if (!def) {
    if (descEl) descEl.textContent = '';
    document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]').forEach(cb => {
      const wrap = cb.closest('.agent-check-row');
      const modelSel = wrap && wrap.querySelector('.agent-triplet-model');
      const effortSel = wrap && wrap.querySelector('.agent-triplet-effort');
      if (modelSel) modelSel.value = '';
      if (effortSel) effortSel.value = '';
    });
    return;
  }
  if (descEl) descEl.textContent = def.description || def.stages.map(s => s.type + (s.agents ? '(' + s.agents.join(',') + ')' : '')).join(' → ');
  const resolved = def.resolved || {};
  const agents = Array.isArray(resolved.agents) ? resolved.agents : [];
  document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]').forEach(cb => {
    cb.checked = agents.includes(cb.value);
  });
  updateAutonomousModeControls();
  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  if (evalSelect) evalSelect.value = resolved.evalAgent || '';
  if (reviewSelect) reviewSelect.value = resolved.reviewAgent || '';
  if (stopAfter && resolved.stopAfter) stopAfter.value = resolved.stopAfter;
  H.updateReviewerTripletSelects(resolved.reviewAgent || '');
  const reviewAgent = resolved.reviewAgent || '';
  const modelOverrides = resolved.modelOverrides || {};
  const effortOverrides = resolved.effortOverrides || {};
  document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]').forEach(cb => {
    const agentId = cb.value;
    const wrap = cb.closest('.agent-check-row');
    const modelSel = wrap && wrap.querySelector('.agent-triplet-model');
    const effortSel = wrap && wrap.querySelector('.agent-triplet-effort');
    if (modelSel) modelSel.value = agentId in modelOverrides ? (modelOverrides[agentId] || '') : '';
    if (effortSel) effortSel.value = agentId in effortOverrides ? (effortOverrides[agentId] || '') : '';
  });
  const reviewModelSel = document.getElementById('autonomous-review-model');
  const reviewEffortSel = document.getElementById('autonomous-review-effort');
  if (reviewModelSel && reviewAgent in modelOverrides) reviewModelSel.value = modelOverrides[reviewAgent] || '';
  if (reviewEffortSel && reviewAgent in effortOverrides) reviewEffortSel.value = effortOverrides[reviewAgent] || '';
}

async function saveCurrentAsWorkflow() {
  const slug = (window.prompt('Save as workflow — enter a slug (lowercase letters, digits, hyphens):') || '').trim();
  if (!slug) return;
  const selectedAgents = [...document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]:checked')].map(cb => cb.value);
  if (selectedAgents.length === 0) {
    H.showToast('Select at least one implementation agent before saving', null, null, { error: true });
    return;
  }
  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  const evalAgent = evalSelect && !evalSelect.disabled ? String(evalSelect.value || '').trim() : '';
  const reviewAgent = reviewSelect && !reviewSelect.disabled ? String(reviewSelect.value || '').trim() : '';
  const stopValue = stopAfter ? String(stopAfter.value || 'close').trim() : 'close';

  const stages = [{ type: 'implement', agents: selectedAgents }];
  if (reviewAgent) {
    const reviewModelSel = document.getElementById('autonomous-review-model');
    const reviewEffortSel = document.getElementById('autonomous-review-effort');
    const reviewModel = reviewModelSel ? String(reviewModelSel.value || '').trim() : '';
    const reviewEffort = reviewEffortSel ? String(reviewEffortSel.value || '').trim() : '';
    const reviewerEntry = (reviewModel || reviewEffort)
      ? { id: reviewAgent, ...(reviewModel ? { model: reviewModel } : {}), ...(reviewEffort ? { effort: reviewEffort } : {}) }
      : reviewAgent;
    stages.push({ type: 'review', agents: [reviewerEntry] });
    stages.push({ type: 'revision', agents: [selectedAgents[0]] });
  }
  if (evalAgent && selectedAgents.length > 1) {
    stages.push({ type: 'eval', agents: [evalAgent] });
  }
  if (stopValue === 'close') stages.push({ type: 'close' });

  try {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo: autonomousModalRepoPath,
        definition: { slug, label: slug, stages },
        scope: 'project'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      H.showToast('Save failed: ' + (data.error || res.statusText), null, null, { error: true });
      return;
    }
    H.showToast('Saved workflow "' + slug + '"');
    await populateAutonomousWorkflowDropdown(autonomousModalRepoPath);
    const select = document.getElementById('autonomous-workflow');
    if (select) select.value = slug;
  } catch (error) {
    H.showToast('Save failed: ' + error.message, null, null, { error: true });
  }
}

function hideAutonomousModal() {
  const modal = document.getElementById('autonomous-modal');
  if (modal) modal.style.display = 'none';
  H.setPickerRecommendation(null);
  H.renderPickerRecommendationBanner(null, 'autonomous-picker-recommendation');
  autonomousModalFeature = null;
  autonomousModalRepoPath = null;
  autonomousModalBtn = null;
  autonomousModalModels = null;
  autonomousModalWorkflowSlug = '';
  autonomousModalSubmitting = false;
  setAutonomousSubmitLoading(false);
}

function buildAutonomousAgentOptions(taskType, options) {
  const opts = options || {};
  const includeNone = !!opts.includeNone;
  const noneLabel = opts.noneLabel || 'none';
  const selectedAgents = Array.isArray(opts.selectedAgents) ? opts.selectedAgents : [];
  const rows = [];
  if (includeNone) rows.push({ value: '', label: noneLabel });
  H.getAutonomousAgentIdsList().forEach((agentId) => {
    const displayName = H.getAgentDisplayNames()[agentId] || agentId;
    const modelName = (autonomousModalModels && autonomousModalModels[agentId] && autonomousModalModels[agentId][taskType]) || '';
    const sameAsImplementer = selectedAgents.includes(agentId);
    const suffix = sameAsImplementer ? ' · implementing' : '';
    const label = modelName
      ? (agentId + ' · ' + displayName + ' · ' + modelName + suffix)
      : (agentId + ' · ' + displayName + suffix);
    rows.push({ value: agentId, label });
  });
  return rows;
}

/** Set autonomous: reviewer row on the same modal as implementers (agent-picker). */
function populateSetAgentPickerReviewerSection(repoPath, implementerIds) {
  const sel = document.getElementById('agent-picker-review-agent');
  if (!sel) return Promise.resolve();
  const setup = function(models) {
    const prev = autonomousModalModels;
    autonomousModalModels = models || {};
    H.replaceSelectOptions(sel, buildAutonomousAgentOptions('review', {
      includeNone: true,
      noneLabel: 'No code review (skip review step)',
      selectedAgents: Array.isArray(implementerIds) ? implementerIds : [],
    }));
    sel.value = '';
    sel.onchange = function() {
      H.updateReviewerTripletSelects(String(sel.value || '').trim(), 'picker-set');
    };
    H.updateReviewerTripletSelects('', 'picker-set');
    autonomousModalModels = prev;
  };
  if (typeof H.fetchAgentModels === 'function') {
    return H.fetchAgentModels(repoPath).then(setup).catch(function() { setup({}); });
  }
  setup({});
  return Promise.resolve();
}
if (typeof window !== 'undefined') window.populateSetAgentPickerReviewerSection = populateSetAgentPickerReviewerSection;

function updateAutonomousEvalOptions() {
  const evalSelect = document.getElementById('autonomous-eval-agent');
  if (!evalSelect) return;
  const previousValue = String(evalSelect.value || '').trim();

  H.replaceSelectOptions(evalSelect, buildAutonomousAgentOptions('evaluate'));

  if (previousValue && H.getAutonomousAgentIdsList().includes(previousValue)) {
    evalSelect.value = previousValue;
  }
}

function updateAutonomousReviewOptions() {
  const reviewSelect = document.getElementById('autonomous-review-agent');
  if (!reviewSelect) return;
  const previousValue = String(reviewSelect.value || '').trim();
  const selectedAgents = [...document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]:checked')].map(cb => cb.value);

  reviewSelect.disabled = false;
  H.replaceSelectOptions(reviewSelect, buildAutonomousAgentOptions('review', {
    includeNone: true,
    noneLabel: 'none',
    selectedAgents
  }));

  if (previousValue && H.getAutonomousAgentIdsList().includes(previousValue)) {
    reviewSelect.value = previousValue;
    H.updateReviewerTripletSelects(reviewSelect.value);
    return;
  }
  reviewSelect.value = H.getAutonomousAgentIdsList().find((agentId) => !selectedAgents.includes(agentId)) || '';
  H.updateReviewerTripletSelects(reviewSelect.value);
}

function updateAutonomousModeControls() {
  const selectedAgents = [...document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]:checked')].map(cb => cb.value);
  const isSolo = selectedAgents.length === 1;
  const evalWrap = document.getElementById('autonomous-eval-wrap');
  const reviewWrap = document.getElementById('autonomous-review-wrap');
  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  if (!evalWrap || !reviewWrap || !evalSelect || !reviewSelect || !stopAfter) return;

  const previousStop = String(stopAfter.value || 'close').trim();
  evalWrap.style.display = isSolo ? 'none' : '';
  reviewWrap.style.display = isSolo ? '' : 'none';
  evalSelect.disabled = isSolo;
  reviewSelect.disabled = !isSolo;

  updateAutonomousEvalOptions();
  updateAutonomousReviewOptions();

  const stopOptions = isSolo
    ? [
        { value: 'close', label: 'close (default)' },
        { value: 'review', label: 'review' },
        { value: 'implement', label: 'implement' }
      ]
    : [
        { value: 'close', label: 'close (default)' },
        { value: 'eval', label: 'eval' },
        { value: 'implement', label: 'implement' }
      ];

  H.replaceSelectOptions(stopAfter, stopOptions);
  stopAfter.value = stopOptions.some(opt => opt.value === previousStop) ? previousStop : 'close';
}

async function submitAutonomousModal() {
  if (autonomousModalSubmitting) return;
  if (!autonomousModalFeature) return;
  const selectedAgents = [...document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]:checked')].map(cb => cb.value);
  if (selectedAgents.length === 0) {
    H.showToast('Select at least one implementation agent', null, null, { error: true });
    return;
  }

  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  const evalAgent = evalSelect && !evalSelect.disabled ? String(evalSelect.value || '').trim() : '';
  const reviewAgent = reviewSelect && !reviewSelect.disabled ? String(reviewSelect.value || '').trim() : '';
  const reviewModelSel = document.getElementById('autonomous-review-model');
  const reviewEffortSel = document.getElementById('autonomous-review-effort');
  const reviewModel = reviewAgent && reviewModelSel ? String(reviewModelSel.value || '').trim() : '';
  const reviewEffort = reviewAgent && reviewEffortSel ? String(reviewEffortSel.value || '').trim() : '';
  const stopValue = stopAfter ? String(stopAfter.value || 'close').trim() : 'close';
  if (stopValue === 'review' && !reviewAgent) {
    H.showToast('Select a reviewer to stop after review', null, null, { error: true });
    return;
  }

  autonomousModalSubmitting = true;
  setAutonomousSubmitLoading(true);

  const triplets = selectedAgents.map(id => {
    const row = document.querySelector('#autonomous-agent-checks input[value="' + id + '"]');
    const wrap = row && row.closest('.agent-check-row');
    const modelSel = wrap && wrap.querySelector('.agent-triplet-model');
    const effortSel = wrap && wrap.querySelector('.agent-triplet-effort');
    return {
      id,
      model: modelSel && modelSel.value ? modelSel.value : null,
      effort: effortSel && effortSel.value ? effortSel.value : null,
    };
  });
  const triArgs = H.tripletsToCliArgs(triplets);
  const modelsCsv = (triArgs.find(a => a.startsWith('--models=')) || '').slice('--models='.length) || '';
  const effortsCsv = (triArgs.find(a => a.startsWith('--efforts=')) || '').slice('--efforts='.length) || '';

  // F322: warn if a selected agent is below 20% on any budget limit.
  try {
    if (typeof H.fetchBudget === 'function') {
      await H.fetchBudget();
      const warning = H.budgetWarningForAgents([...selectedAgents, evalAgent, reviewAgent].filter(Boolean));
      if (warning && !window.confirm(warning)) {
        autonomousModalSubmitting = false;
        setAutonomousSubmitLoading(false);
        return;
      }
    }
  } catch (_) { /* budget check is best-effort */ }

  const featureId = autonomousModalFeature.id;
  const repoPath = autonomousModalRepoPath;
  const btn = autonomousModalBtn;
  hideAutonomousModal();
  await H.requestFeatureAutonomousRun(featureId, {
    agents: selectedAgents,
    evalAgent,
    reviewAgent,
    stopAfter: stopValue,
    models: modelsCsv || undefined,
    efforts: effortsCsv || undefined,
    reviewModel: reviewModel || undefined,
    reviewEffort: reviewEffort || undefined,
    workflow: autonomousModalWorkflowSlug || undefined,
  }, repoPath, btn);
}

let autoInitDone = false;
function initAutonomousModal() {
  if (autoInitDone) return;
  autoInitDone = true;
  const modal = document.getElementById('autonomous-modal');
  if (!modal) return;

  document.getElementById('autonomous-modal-cancel').onclick = () => hideAutonomousModal();
  modal.onclick = (e) => { if (e.target === e.currentTarget) hideAutonomousModal(); };
  document.getElementById('autonomous-modal-submit').onclick = () => submitAutonomousModal();
  const saveBtn = document.getElementById('autonomous-modal-save-workflow');
  if (saveBtn) saveBtn.onclick = () => saveCurrentAsWorkflow();
  const workflowSelect = document.getElementById('autonomous-workflow');
  if (workflowSelect) {
    workflowSelect.addEventListener('change', (e) => {
      applyAutonomousWorkflow(String(e.target.value || '').trim());
      budgetNotice();
    });
  }
  const reviewAgentSelect = document.getElementById('autonomous-review-agent');
  if (reviewAgentSelect) {
    reviewAgentSelect.addEventListener('change', () => {
      H.updateReviewerTripletSelects(reviewAgentSelect.value);
      budgetNotice();
    });
  }
  const evalAgentSelect = document.getElementById('autonomous-eval-agent');
  if (evalAgentSelect) evalAgentSelect.addEventListener('change', () => budgetNotice());
  modal.addEventListener('change', (e) => {
    if (e.target && e.target.closest('#autonomous-agent-checks')) {
      updateAutonomousModeControls();
    }
    budgetNotice();
  });
}

export async function open(ctx) {
  if (ctx.va && ctx.va.action === 'feature-autonomous-stop') {
    const feature = ctx.feature;
    const repoPath = ctx.repoPath;
    const btn = ctx.btn;
    const H = ctx.helpers || {};
    const showConfirm = H.showConfirm || (() => Promise.resolve(false));
    const requestAction = H.requestAction || ctx.api.requestAction;
    const ok = await showConfirm({
      title: 'Stop automation?',
      message: 'This stops AutoConductor only. Current agent sessions keep running and workflow state is unchanged.',
      confirmLabel: 'Stop automation',
      cancelLabel: 'Keep running',
      danger: false,
    });
    if (!ok) return;
    await requestAction('feature-autonomous-stop', [String(feature.id)], repoPath, btn);
    return;
  }
  initAutonomousModal();
  await showAutonomousModal(ctx.feature, ctx.repoPath, ctx.btn);
}

export function close() {
  hideAutonomousModal();
}
