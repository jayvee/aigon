
import * as H from './shared.js';
/** F519 action module: close */

let closeModalResolve = null;
let closeModalFeature = null;
let closeModalRepoPath = null;
let closeModalPipelineType = null;
function showCloseModal(feature, repoPath, pipelineType) {
  closeModalFeature = feature;
  closeModalRepoPath = repoPath;
  closeModalPipelineType = pipelineType;

  const agents = feature.agents || [];
  const winnerAgent = feature.winnerAgent || (agents.length > 0 ? agents[0].id : '');

  // Populate winner radio buttons
  const winnerContainer = document.getElementById('close-modal-winners');
  H.replaceNodeChildren(winnerContainer, agents.map(a => {
    const displayName = H.getAgentDisplayNames()[a.id] || a.id;
    const statusLabel = a.status || 'idle';
    return H.buildAgentCheckRow({
      type: 'radio',
      name: 'close-winner',
      value: a.id,
      checked: a.id === winnerAgent,
      label: a.id,
      hint: displayName + ' (' + statusLabel + ')'
    });
  }));

  // Populate adoption checkboxes (losers = non-winner agents)
  const adoptContainer = document.getElementById('close-modal-adopt');
  if (agents.length > 1) {
    document.getElementById('close-modal-adopt-section').style.display = '';
    updateAdoptionCheckboxes();
  } else {
    document.getElementById('close-modal-adopt-section').style.display = 'none';
  }

  // Update title
  document.getElementById('close-modal-desc').textContent = '#' + feature.id + ' ' + feature.name;

  // Show modal
  document.getElementById('close-modal').style.display = 'flex';
}

function updateAdoptionCheckboxes() {
  if (!closeModalFeature) return;
  const agents = closeModalFeature.agents || [];
  const selectedWinner = document.querySelector('#close-modal-winners input[name="close-winner"]:checked');
  const winnerId = selectedWinner ? selectedWinner.value : '';

  const losers = agents.filter(a => a.id !== winnerId);
  const adoptContainer = document.getElementById('close-modal-adopt');

  if (losers.length === 0) {
    adoptContainer.innerHTML = '<span style="color:var(--text-tertiary);font-size:12px">No other agents to adopt from</span>';
    return;
  }

  const adoptRows = [];
  if (losers.length > 1) {
    adoptRows.push(H.buildAgentCheckRow({
      value: 'all',
      id: 'close-adopt-all',
      label: 'Adopt all',
      hint: 'Merge changes from all losing agents'
    }));
  }
  losers.forEach(a => {
    const displayName = H.getAgentDisplayNames()[a.id] || a.id;
    adoptRows.push(H.buildAgentCheckRow({
      value: a.id,
      inputClassName: 'close-adopt-agent',
      label: 'Adopt from ' + a.id,
      hint: displayName
    }));
  });
  H.replaceNodeChildren(adoptContainer, adoptRows);

  // Wire "adopt all" toggle
  const adoptAll = document.getElementById('close-adopt-all');
  if (adoptAll) {
    adoptAll.onchange = () => {
      adoptContainer.querySelectorAll('.close-adopt-agent').forEach(cb => { cb.checked = adoptAll.checked; });
    };
  }
}

function hideCloseModal() {
  document.getElementById('close-modal').style.display = 'none';
  closeModalFeature = null;
  closeModalRepoPath = null;
  closeModalPipelineType = null;
}

async function submitCloseModal() {
  if (!closeModalFeature) return;

  const selectedWinner = document.querySelector('#close-modal-winners input[name="close-winner"]:checked');
  if (!selectedWinner) { H.showToast('Select a winner agent'); return; }
  const winnerId = selectedWinner.value;

  // Gather adoption flags
  const adoptFlags = [];
  document.querySelectorAll('#close-modal-adopt .close-adopt-agent:checked').forEach(cb => {
    adoptFlags.push('--adopt', cb.value);
  });

  // Capture values before hideCloseModal nulls them
  const featureId = closeModalFeature.id;
  const repoPath = closeModalRepoPath;

  hideCloseModal();
  await H.requestAction('feature-close', [featureId, winnerId, ...adoptFlags], repoPath);
}

export async function open(ctx) {
  init();
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

let closeInitDone = false;
export function init() {
  if (closeInitDone) return;
  closeInitDone = true;
    const modal = document.getElementById('close-modal');
    if (!modal) return;
    document.getElementById('close-modal-cancel').onclick = () => hideCloseModal();
    modal.onclick = (e) => { if (e.target === e.currentTarget) hideCloseModal(); };
    document.getElementById('close-modal-submit').onclick = () => submitCloseModal();
    modal.addEventListener('change', (e) => {
      if (e.target.name === 'close-winner') updateAdoptionCheckboxes();
    });
}


