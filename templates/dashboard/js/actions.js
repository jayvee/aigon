// ── Unified action renderer + dispatcher ────────────────────────────────────
// Single source of truth for feature/research/feedback action buttons.
// Both Monitor and Pipeline views call these functions instead of maintaining
// their own rendering logic.

// Display name mapping (moved from pipeline.js for shared access)
const AGENT_DISPLAY_NAMES = { cc: 'Claude Code', gg: 'Gemini', cx: 'Codex', cu: 'Cursor', mv: 'Mistral Vibe', solo: 'Agent' };
const AGENT_SHORT_NAMES = { cc: 'CC', gg: 'GG', cx: 'CX', cu: 'CU', mv: 'MV', solo: 'Drive' };

// Maps action + priority to button CSS class
function validActionBtnClass(action, priority) {
  if (priority === 'high') return 'btn btn-primary';
  if (action === 'feature-stop' || action === 'research-stop') return 'btn btn-danger';
  return 'btn btn-secondary';
}

/**
 * Builds unified action button HTML from validActions.
 * Implements 3-tier hierarchy:
 *   Primary: first high-priority action → btn-primary
 *   Secondary: other high-priority actions → btn-secondary
 *   Overflow: everything else → hidden in ⋯ dropdown
 *
 * Special eval-done logic: when evalStatus === 'pick winner' and winnerAgent
 * exists, primary button becomes "Close & Merge [winner]".
 *
 * @param {object} feature - feature object with validActions, evalStatus, winnerAgent, agents, stage
 * @param {string} repoPath - repo path for API calls
 * @param {string} pipelineType - 'features', 'research', or 'feedback'
 * @returns {string} HTML string with data-va-action and data-agent attributes
 */
function renderActionButtons(feature, repoPath, pipelineType) {
  const validActions = feature.validActions || [];
  if (validActions.length === 0) return '';

  // Filter: non-per-agent, non-infra/view actions render as card-level buttons
  // Per-agent actions are handled by buildAgentSectionHtml.
  // Infra/view actions are rendered inline in agent sections or special UI elements.
  const evalRunning = feature.evalSession && feature.evalSession.running;
  // Collapse select-winner actions into a single "Close" button
  const hasSelectWinner = validActions.some(va => va.action === 'select-winner');
  const buttonsToRender = validActions.filter(va => {
    if (va.action === 'select-winner') return false; // collapsed into close button below
    if (va.agentId) return false; // per-agent actions handled by buildAgentSectionHtml
    if (va.category === 'infra' || va.category === 'view') return false; // infra/view handled separately
    // Hide eval/review actions when eval session is already running
    if (evalRunning && (va.action === 'feature-eval' || va.action === 'research-eval' || va.action === 'feature-review')) return false;
    return true;
  });
  // Inject a synthetic close action when select-winner is available
  if (hasSelectWinner) {
    buttonsToRender.push({ action: 'feature-close', label: 'Close', priority: 'high' });
  }

  // Deduplicate while preserving server-provided order.
  const seen = new Set();
  const deduped = [];
  for (const va of buttonsToRender) {
    const key = va.action + (va.agentId || '');
    if (!seen.has(key)) { seen.add(key); deduped.push(va); }
  }

  // Sort: high-priority first, then normal, then stop/danger last
  deduped.sort((a, b) => {
    const rank = v => v.priority === 'high' ? 0 : (v.action === 'feature-stop' || v.action === 'research-stop') ? 2 : 1;
    return rank(a) - rank(b);
  });

  // Special eval-done logic: when winner is known, override close label
  const evalPickWinner = feature.evalStatus === 'pick winner' && feature.winnerAgent;

  // Partition into tiers
  const primary = [];
  const secondary = [];
  const overflow = [];

  deduped.forEach((va, i) => {
    // When winner is picked, promote close to primary and demote eval to overflow
    if (evalPickWinner) {
      if (va.action === 'feature-close') { primary.push(va); return; }
      if (va.action === 'feature-eval') { overflow.push(va); return; }
    }
    if (va.priority === 'high') {
      if (primary.length === 0) primary.push(va);
      else secondary.push(va);
    } else {
      overflow.push(va);
    }
  });

  // If no high-priority actions, promote first normal action to primary
  if (primary.length === 0 && overflow.length > 0) {
    primary.push(overflow.shift());
  }

  function actionLabel(va) {
    if (va.action === 'feature-close' && hasSelectWinner) {
      return 'Close';
    }
    if (evalPickWinner && va.action === 'feature-close') {
      return 'Close & Merge ' + (AGENT_DISPLAY_NAMES[feature.winnerAgent] || feature.winnerAgent);
    }
    return va.label;
  }

  function renderBtn(va, cls) {
    const agentAttr = va.agentId ? ' data-agent="' + escHtml(va.agentId) + '"' : '';
    return '<button class="' + cls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '"' + agentAttr + '>' + escHtml(actionLabel(va)) + '</button>';
  }

  let html = '';

  // Primary button
  primary.forEach(va => {
    html += renderBtn(va, 'btn btn-primary');
  });

  // Secondary buttons
  secondary.forEach(va => {
    html += renderBtn(va, 'btn btn-secondary');
  });

  // Add "View Review" entries for each review session
  const reviews = feature.reviewSessions || [];
  reviews.forEach(r => {
    if (r.session) {
      const agentName = AGENT_DISPLAY_NAMES[r.agent] || r.agent;
      overflow.push({ _reviewSession: r.session, _reviewLabel: 'View ' + agentName + ' Review' });
    }
  });

  // Overflow dropdown
  if (overflow.length > 0) {
    const items = overflow.map(va => {
      // Special: review session link
      if (va._reviewSession) {
        return '<button class="kcard-overflow-item" data-view-review="' + escHtml(va._reviewSession) + '">' + escHtml(va._reviewLabel) + '</button>';
      }
      const agentAttr = va.agentId ? ' data-agent="' + escHtml(va.agentId) + '"' : '';
      const cls = (va.action === 'feature-stop' || va.action === 'research-stop') ? 'kcard-overflow-item kcard-va-btn btn-danger' : 'kcard-overflow-item kcard-va-btn';
      return '<button class="' + cls + '" data-va-action="' + escHtml(va.action) + '"' + agentAttr + '>' + escHtml(actionLabel(va)) + '</button>';
    }).join('');
    html += '<div class="kcard-overflow"><button class="btn btn-overflow kcard-overflow-toggle" type="button">⋯</button><div class="kcard-overflow-menu">' + items + '</div></div>';
  }

  return html;
}

/**
 * Unified action dispatcher — handles clicks on validAction buttons.
 * Both Monitor and Pipeline delegate here.
 */
async function handleFeatureAction(va, feature, repoPath, btn, pipelineType) {
  const id = feature.id;
  const agentId = va.agentId || null;

  function pCmd(action) {
    const prefix = pipelineType === 'research' ? 'research' : pipelineType === 'feedback' ? 'feedback' : 'feature';
    return prefix + '-' + action;
  }

  switch (va.action) {
    case 'open-session':
    case 'feature-open':
    case 'feature-attach':
    case 'feature-focus':
    case 'research-open':
    case 'research-attach':
      await requestFeatureOpen(id, agentId, repoPath, btn, pipelineType);
      break;
    case 'feature-start':
    case 'research-start': {
      const agents = await showAgentPicker(id, feature.name, { repoPath, taskType: 'implement', action: va.action });
      if (!agents) return;
      await requestAction(pCmd('start'), [id, ...agents], repoPath, btn);
      break;
    }
    case 'feature-autopilot': {
      const agents = await showAgentPicker(id, feature.name, { title: 'Select Autopilot Agents', submitLabel: 'Autopilot', repoPath, taskType: 'implement', action: va.action });
      if (!agents) return;
      if (agents.length < 2) { showToast('Select at least 2 agents for autopilot'); return; }
      await requestAction('feature-autopilot', [id, ...agents], repoPath, btn);
      break;
    }
    case 'feature-eval': {
      const implAgents = (feature.agents || []).map(a => a.id);
      const evalAgent = await showAgentPicker(id, feature.name, { single: true, title: 'Choose evaluation agent', submitLabel: 'Run Evaluation', implementingAgents: implAgents, repoPath, taskType: 'evaluate', action: va.action });
      if (!evalAgent || evalAgent.length === 0) return;
      if (feature.stage !== 'in-evaluation') {
        await requestAction('feature-eval', [id, '--setup-only'], repoPath, btn);
      }
      await requestFeatureOpen(id, evalAgent[0], repoPath, null, pipelineType, 'eval');
      break;
    }
    case 'research-eval': {
      const researchAgents = (feature.agents || []).map(a => a.id);
      const synthAgent = await showAgentPicker(id, feature.name, { single: true, title: 'Choose evaluation agent', submitLabel: 'Run Evaluation', implementingAgents: researchAgents, repoPath, taskType: 'evaluate', action: va.action });
      if (!synthAgent || synthAgent.length === 0) return;
      if (feature.stage !== 'in-evaluation') {
        await requestAction('research-eval', [id, '--setup-only'], repoPath, btn);
      }
      await requestFeatureOpen(id, synthAgent[0], repoPath, null, pipelineType, 'eval');
      break;
    }
    case 'feature-review': {
      const implAgentsR = (feature.agents || []).map(a => a.id);
      const reviewAgent = await showAgentPicker(id, feature.name, { single: true, title: 'Choose review agent', submitLabel: 'Run Review', implementingAgents: implAgentsR, repoPath, taskType: 'implement', action: va.action });
      if (!reviewAgent || reviewAgent.length === 0) return;
      await requestFeatureOpen(id, reviewAgent[0], repoPath, null, pipelineType, 'review');
      break;
    }
    case 'feature-prioritise':
    case 'research-prioritise':
      await requestAction(pCmd('prioritise'), [feature.name], repoPath, btn);
      break;
    case 'select-winner':
      await requestAction('feature-close', [id, agentId], repoPath, btn);
      break;
    case 'feature-close': {
      // Fleet features with multiple agents → show close modal with winner + adoption
      const agents = feature.agents || [];
      const hasMultipleAgents = agents.length > 1 && agents[0].id !== 'solo';
      if (hasMultipleAgents) {
        showCloseModal(feature, repoPath, pipelineType);
      } else if (feature.stage === 'in-evaluation') {
        // Solo eval — pick winner via agent picker
        const picked = await showAgentPicker(id, feature.name, { single: true, title: 'Pick winner to merge', submitLabel: 'Close & Merge', preselect: feature.winnerAgent, repoPath, taskType: 'evaluate', action: va.action });
        if (!picked || picked.length === 0) return;
        await requestAction('feature-close', [id, picked[0]], repoPath, btn);
      } else {
        await requestAction('feature-close', [id, ...(agentId ? [agentId] : [])], repoPath, btn);
      }
      break;
    }
    case 'feature-stop':
    case 'research-stop':
      await requestAction(va.action, [id, ...(agentId ? [agentId] : [])], repoPath, btn);
      break;
    default:
      // Generic handler: agent-mode actions get agent picker + terminal session
      if (va.mode === 'agent') {
        const implAgents = (feature.agents || []).map(a => a.id);
        const actionLabel = va.label || va.action.split('-').pop();
        const picked = await showAgentPicker(id, feature.name, {
          single: true,
          title: 'Choose agent for ' + actionLabel,
          submitLabel: actionLabel,
          implementingAgents: implAgents,
          repoPath,
          taskType: va.action.includes('eval') ? 'evaluate' : 'implement',
          action: va.action
        });
        if (!picked || picked.length === 0) return;
        await requestFeatureOpen(id, picked[0], repoPath, null, pipelineType, va.action.split('-').pop());
      } else {
        await requestAction(va.action, [id, ...(agentId ? [agentId] : [])], repoPath, btn);
      }
  }
}

// ── Close modal logic ─────────────────────────────────────────────────────

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
  winnerContainer.innerHTML = agents.map(a => {
    const displayName = AGENT_DISPLAY_NAMES[a.id] || a.id;
    const statusLabel = a.status || 'idle';
    const checked = a.id === winnerAgent ? ' checked' : '';
    return '<label class="agent-check-row"><input type="radio" name="close-winner" value="' + escHtml(a.id) + '"' + checked + '>' +
      '<span class="agent-check-label">' + escHtml(a.id) + '</span>' +
      '<span class="agent-check-hint">' + escHtml(displayName) + ' (' + escHtml(statusLabel) + ')</span></label>';
  }).join('');

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

  let html = '';
  if (losers.length > 1) {
    html += '<label class="agent-check-row"><input type="checkbox" value="all" id="close-adopt-all"><span class="agent-check-label">Adopt all</span><span class="agent-check-hint">Merge changes from all losing agents</span></label>';
  }
  losers.forEach(a => {
    const displayName = AGENT_DISPLAY_NAMES[a.id] || a.id;
    html += '<label class="agent-check-row"><input type="checkbox" value="' + escHtml(a.id) + '" class="close-adopt-agent">' +
      '<span class="agent-check-label">Adopt from ' + escHtml(a.id) + '</span>' +
      '<span class="agent-check-hint">' + escHtml(displayName) + '</span></label>';
  });
  adoptContainer.innerHTML = html;

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
  if (!selectedWinner) { showToast('Select a winner agent'); return; }
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
  await requestAction('feature-close', [featureId, winnerId, ...adoptFlags], repoPath);
}

// Wire close modal events once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('close-modal');
  if (!modal) return;

  document.getElementById('close-modal-cancel').onclick = () => hideCloseModal();
  modal.onclick = (e) => { if (e.target === e.currentTarget) hideCloseModal(); };
  document.getElementById('close-modal-submit').onclick = () => submitCloseModal();

  // Re-render adoption checkboxes when winner changes
  modal.addEventListener('change', (e) => {
    if (e.target.name === 'close-winner') updateAdoptionCheckboxes();
  });
});
