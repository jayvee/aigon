// ── Unified action renderer + dispatcher ────────────────────────────────────
// Single source of truth for feature/research/feedback action buttons.
// Both Monitor and Pipeline views call these functions instead of maintaining
// their own rendering logic.

// Display name mapping (moved from pipeline.js for shared access)
const AGENT_DISPLAY_NAMES = { cc: 'Claude Code', gg: 'Gemini', cx: 'Codex', cu: 'Cursor', solo: 'Agent' };
const AGENT_SHORT_NAMES = { cc: 'CC', gg: 'GG', cx: 'CX', cu: 'CU', solo: 'Drive' };

function createEl(tag, options) {
  const el = document.createElement(tag);
  const opts = options || {};
  if (opts.className) el.className = opts.className;
  if (opts.text != null) el.textContent = String(opts.text);
  if (opts.attrs) {
    Object.entries(opts.attrs).forEach(([key, value]) => {
      if (value != null) el.setAttribute(key, String(value));
    });
  }
  return el;
}

function buildAgentCheckRow(options) {
  const opts = options || {};
  const label = createEl('label', { className: 'agent-check-row' });
  const input = createEl('input', {
    attrs: {
      type: opts.type || 'checkbox',
      value: opts.value || '',
      name: opts.name || null,
      id: opts.id || null
    }
  });
  if (opts.checked) input.checked = true;
  if (opts.inputClassName) input.className = opts.inputClassName;
  label.appendChild(input);
  label.appendChild(createEl('span', { className: 'agent-check-label', text: opts.label || '' }));
  if (opts.hint) label.appendChild(createEl('span', { className: 'agent-check-hint', text: opts.hint }));
  if (opts.model) label.appendChild(createEl('span', { className: 'agent-check-model', text: opts.model }));
  return label;
}

function replaceNodeChildren(node, children) {
  node.replaceChildren(...children);
}

function replaceSelectOptions(select, options) {
  const opts = (options || []).map(option => {
    const el = document.createElement('option');
    el.value = String(option.value || '');
    el.textContent = String(option.label || '');
    return el;
  });
  replaceNodeChildren(select, opts);
}

// Maps action + priority to button CSS class
function validActionBtnClass(action, priority) {
  if (priority === 'high') return 'btn btn-primary';
  if (action === 'feature-stop' || action === 'research-stop' || action === 'feature-reset' || action === 'research-reset') return 'btn btn-danger';
  return 'btn btn-secondary';
}

// Simple one-shot confirmation modal with default focus on Cancel.
// Resolves true on confirm, false on cancel/escape.
// Pass danger:true for destructive actions (red border + warning icon).
function showConfirm(opts) {
  return new Promise((resolve) => {
    const title = (opts && opts.title) || 'Confirm';
    const message = (opts && opts.message) || 'Are you sure?';
    const confirmLabel = (opts && opts.confirmLabel) || 'Confirm';
    const cancelLabel = (opts && opts.cancelLabel) || 'Cancel';
    const danger = !!(opts && opts.danger);

    const overlay = document.createElement('div');
    overlay.className = 'danger-confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-panel,#1a1d23);border:1px solid ' + (danger ? 'rgba(239,68,68,.5)' : 'var(--border-color,#2a2f3a)') + ';border-radius:8px;padding:20px;max-width:460px;color:var(--text-primary,#eee);box-shadow:0 10px 40px rgba(0,0,0,.5)';
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:8px;color:' + (danger ? '#fca5a5' : 'var(--text-primary,#eee)');
    titleEl.textContent = (danger ? '\u26a0 ' : '') + title;
    const messageEl = document.createElement('div');
    messageEl.style.cssText = 'font-size:14px;line-height:1.5;margin-bottom:18px;color:var(--text-secondary,#bbb)';
    messageEl.textContent = message;
    const actionsEl = document.createElement('div');
    actionsEl.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const cancelButton = createEl('button', { className: 'btn btn-secondary confirm-cancel', text: cancelLabel, attrs: { type: 'button' } });
    const okButton = createEl('button', { className: 'btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' confirm-ok', text: confirmLabel, attrs: { type: 'button' } });
    actionsEl.appendChild(cancelButton);
    actionsEl.appendChild(okButton);
    box.appendChild(titleEl);
    box.appendChild(messageEl);
    box.appendChild(actionsEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cancelBtn = box.querySelector('.confirm-cancel');
    const okBtn = box.querySelector('.confirm-ok');

    function cleanup(result) {
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      if (e.key === 'Enter') { e.preventDefault(); cleanup(document.activeElement === okBtn); }
    }
    cancelBtn.addEventListener('click', () => cleanup(false));
    okBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', onKey, true);

    setTimeout(() => cancelBtn.focus(), 0);
  });
}

// Convenience wrapper for destructive confirmations (red border + warning icon).
function showDangerConfirm(opts) {
  return showConfirm(Object.assign({}, opts, { danger: true }));
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

  // Sort: high-priority first, then normal, then stop/reset danger actions last
  deduped.sort((a, b) => {
    const rank = v => (
      v.priority === 'high'
        ? 0
        : (v.action === 'feature-stop'
          || v.action === 'research-stop'
          || v.action === 'feature-reset'
          || v.action === 'research-reset')
          ? 2
          : 1
    );
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
      const isDanger = va.action === 'feature-stop' || va.action === 'research-stop' || va.action === 'feature-reset';
      const cls = isDanger ? 'kcard-overflow-item kcard-va-btn btn-danger' : 'kcard-overflow-item kcard-va-btn';
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

  function getLaunchMode(action) {
    if (action === 'feature-eval' || action === 'research-eval') return 'eval';
    if (action === 'feature-review' || action === 'research-review') return 'review';
    return 'do';
  }

  async function launchAgentAction(action, options) {
    const implAgents = (feature.agents || []).map(a => a.id);
    const picked = await showAgentPicker(id, feature.name, {
      single: true,
      title: options.title,
      submitLabel: options.submitLabel,
      implementingAgents: implAgents,
      repoPath,
      taskType: options.taskType,
      action
    });
    if (!picked || picked.length === 0) return;
    if (options.setupAction && feature.stage !== 'in-evaluation') {
      await requestAction(options.setupAction, [id, '--setup-only'], repoPath, btn);
    }
    await requestFeatureOpen(id, picked[0], repoPath, null, pipelineType, getLaunchMode(action));
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
    case 'feature-autonomous-start': {
      showAutonomousModal(feature, repoPath, btn);
      break;
    }
    case 'feature-autopilot': {
      const agents = await showAgentPicker(id, feature.name, { title: 'Select Autopilot Agents', submitLabel: 'Autopilot', repoPath, taskType: 'implement', action: va.action });
      if (!agents) return;
      if (agents.length < 2) { showToast('Select at least 2 agents for autopilot'); return; }
      await requestAction('feature-autopilot', [id, ...agents, '--auto-eval'], repoPath, btn);
      break;
    }
    case 'feature-eval': {
      await launchAgentAction(va.action, {
        title: 'Choose evaluation agent',
        submitLabel: 'Run Evaluation',
        taskType: 'evaluate',
        setupAction: 'feature-eval'
      });
      break;
    }
    case 'research-eval': {
      await launchAgentAction(va.action, {
        title: 'Choose evaluation agent',
        submitLabel: 'Run Evaluation',
        taskType: 'evaluate',
        setupAction: 'research-eval'
      });
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
    case 'feature-reset': {
      // feature 243: destructive reset — confirm before dispatch.
      const msg = (va.metadata && va.metadata.confirmationMessage)
        || 'Kill tmux sessions, remove the worktree and branch (including any uncommitted work on the branch), clear engine state, and move the spec back to Backlog. This cannot be undone.';
      const ok = await showDangerConfirm({
        title: 'Reset feature #' + id + (feature.name ? ' \u2014 ' + feature.name : '') + '?',
        message: msg,
        confirmLabel: 'Reset feature',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await requestAction('feature-reset', [id], repoPath, btn);
      break;
    }
    case 'feature-push': {
      const msg = (va.metadata && va.metadata.confirmationMessage)
        || 'Push feature branch to origin?';
      const ok = await showConfirm({
        title: 'Push feature #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
        message: msg,
        confirmLabel: 'Push',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await requestAction('feature-push', [id], repoPath, btn);
      break;
    }
    default:
      // Generic handler: agent-mode actions get agent picker + terminal session
      if (va.mode === 'agent') {
        const actionLabel = va.label || va.action.split('-').pop();
        await launchAgentAction(va.action, {
          title: 'Choose agent for ' + actionLabel,
          submitLabel: actionLabel,
          taskType: getLaunchMode(va.action) === 'eval' ? 'evaluate' : getLaunchMode(va.action)
        });
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
let autonomousModalFeature = null;
let autonomousModalRepoPath = null;
let autonomousModalBtn = null;
let autonomousModalModels = null;
let autonomousModalWorkflows = [];

const AUTONOMOUS_AGENT_IDS = ['cc', 'cx', 'gg', 'cu'];

function showCloseModal(feature, repoPath, pipelineType) {
  closeModalFeature = feature;
  closeModalRepoPath = repoPath;
  closeModalPipelineType = pipelineType;

  const agents = feature.agents || [];
  const winnerAgent = feature.winnerAgent || (agents.length > 0 ? agents[0].id : '');

  // Populate winner radio buttons
  const winnerContainer = document.getElementById('close-modal-winners');
  replaceNodeChildren(winnerContainer, agents.map(a => {
    const displayName = AGENT_DISPLAY_NAMES[a.id] || a.id;
    const statusLabel = a.status || 'idle';
    return buildAgentCheckRow({
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
    adoptRows.push(buildAgentCheckRow({
      value: 'all',
      id: 'close-adopt-all',
      label: 'Adopt all',
      hint: 'Merge changes from all losing agents'
    }));
  }
  losers.forEach(a => {
    const displayName = AGENT_DISPLAY_NAMES[a.id] || a.id;
    adoptRows.push(buildAgentCheckRow({
      value: a.id,
      inputClassName: 'close-adopt-agent',
      label: 'Adopt from ' + a.id,
      hint: displayName
    }));
  });
  replaceNodeChildren(adoptContainer, adoptRows);

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

// ── Autonomous modal logic ────────────────────────────────────────────────

async function showAutonomousModal(feature, repoPath, btn) {
  autonomousModalFeature = feature;
  autonomousModalRepoPath = repoPath;
  autonomousModalBtn = btn || null;
  const loaded = await Promise.all([
    fetchAgentModels(repoPath).catch(() => ({})),
    fetchFeatureWorkflows(repoPath).catch(() => [])
  ]);
  autonomousModalModels = loaded[0] || {};
  autonomousModalWorkflows = Array.isArray(loaded[1]) ? loaded[1] : [];

  const desc = document.getElementById('autonomous-modal-desc');
  const workflowSelect = document.getElementById('autonomous-workflow-select');
  const checks = document.getElementById('autonomous-agent-checks');
  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  const modal = document.getElementById('autonomous-modal');
  if (!desc || !workflowSelect || !checks || !evalSelect || !reviewSelect || !stopAfter || !modal) return;

  desc.textContent = '#' + feature.id + ' ' + feature.name;
  replaceNodeChildren(checks, AUTONOMOUS_AGENT_IDS.map(agentId => {
    const displayName = AGENT_DISPLAY_NAMES[agentId] || agentId;
    const modelName = (autonomousModalModels && autonomousModalModels[agentId] && autonomousModalModels[agentId].implement) || '';
    return buildAgentCheckRow({
      value: agentId,
      checked: agentId === 'cc',
      label: agentId,
      hint: displayName,
      model: modelName
    });
  }));

  populateAutonomousWorkflowOptions('');
  stopAfter.value = 'close';
  updateAutonomousModeControls();
  modal.style.display = 'flex';
}

function hideAutonomousModal() {
  const modal = document.getElementById('autonomous-modal');
  if (modal) modal.style.display = 'none';
  autonomousModalFeature = null;
  autonomousModalRepoPath = null;
  autonomousModalBtn = null;
  autonomousModalModels = null;
  autonomousModalWorkflows = [];
}

function formatAutonomousWorkflowOption(workflow) {
  const sourceLabel = workflow && workflow.sourceLabel ? workflow.sourceLabel : 'Workflow';
  const label = workflow && workflow.label ? workflow.label : (workflow && workflow.slug ? workflow.slug : 'Workflow');
  return label + ' [' + sourceLabel + ']';
}

function populateAutonomousWorkflowOptions(selectedSlug) {
  const workflowSelect = document.getElementById('autonomous-workflow-select');
  if (!workflowSelect) return;
  const options = [{ value: '', label: 'Custom configuration' }]
    .concat((autonomousModalWorkflows || []).map(workflow => ({
      value: workflow.slug || '',
      label: formatAutonomousWorkflowOption(workflow)
    })));
  replaceSelectOptions(workflowSelect, options);
  workflowSelect.value = options.some(option => option.value === selectedSlug) ? selectedSlug : '';
}

function getAutonomousSelectedAgents() {
  return [...document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]:checked')]
    .map(cb => cb.value);
}

function setAutonomousSelectedAgents(agentIds) {
  const wanted = new Set(Array.isArray(agentIds) ? agentIds : []);
  document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]').forEach(cb => {
    cb.checked = wanted.has(cb.value);
  });
}

function collectAutonomousModalState() {
  const selectedAgents = getAutonomousSelectedAgents();
  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  const evalAgent = evalSelect && !evalSelect.disabled ? String(evalSelect.value || '').trim() : '';
  const reviewAgent = reviewSelect && !reviewSelect.disabled ? String(reviewSelect.value || '').trim() : '';
  const stopValue = stopAfter ? String(stopAfter.value || 'close').trim() : 'close';
  return {
    agents: selectedAgents,
    evalAgent,
    reviewAgent,
    stopAfter: stopValue
  };
}

function applyAutonomousWorkflowSelection(slug) {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) return;
  const workflow = (autonomousModalWorkflows || []).find(entry => entry.slug === normalizedSlug);
  if (!workflow) return;
  setAutonomousSelectedAgents(workflow.agents || []);
  updateAutonomousModeControls({
    evalAgent: workflow.evalAgent || '',
    reviewAgent: workflow.reviewAgent || '',
    stopAfter: workflow.stopAfter || 'close'
  });
}

async function saveAutonomousWorkflow() {
  if (!autonomousModalRepoPath) return;
  const current = collectAutonomousModalState();
  if (current.agents.length === 0) {
    showToast('Select at least one implementation agent', null, null, { error: true });
    return;
  }
  if (current.stopAfter === 'review' && !current.reviewAgent) {
    showToast('Select a reviewer to stop after review', null, null, { error: true });
    return;
  }
  const workflowName = window.prompt('Workflow name');
  const trimmedName = String(workflowName || '').trim();
  if (workflowName === null) return;
  if (!trimmedName) {
    showToast('Workflow name is required', null, null, { error: true });
    return;
  }

  try {
    const payload = await requestSaveFeatureWorkflow({
      name: trimmedName,
      agents: current.agents,
      evalAgent: current.evalAgent,
      reviewAgent: current.reviewAgent,
      stopAfter: current.stopAfter
    }, autonomousModalRepoPath);
    const savedWorkflow = payload && payload.workflow ? payload.workflow : null;
    autonomousModalWorkflows = await fetchFeatureWorkflows(autonomousModalRepoPath).catch(() => autonomousModalWorkflows);
    populateAutonomousWorkflowOptions(savedWorkflow && savedWorkflow.slug ? savedWorkflow.slug : '');
    if (savedWorkflow && savedWorkflow.slug) {
      applyAutonomousWorkflowSelection(savedWorkflow.slug);
    }
    showToast(payload.message || ('Saved workflow: ' + trimmedName));
  } catch (error) {
    showToast('Save workflow failed: ' + error.message, null, null, { error: true });
  }
}

function buildAutonomousAgentOptions(taskType, options) {
  const opts = options || {};
  const includeNone = !!opts.includeNone;
  const noneLabel = opts.noneLabel || 'none';
  const selectedAgents = Array.isArray(opts.selectedAgents) ? opts.selectedAgents : [];
  const rows = [];
  if (includeNone) rows.push({ value: '', label: noneLabel });
  AUTONOMOUS_AGENT_IDS.forEach(agentId => {
    const displayName = AGENT_DISPLAY_NAMES[agentId] || agentId;
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

function updateAutonomousEvalOptions(preferredValue) {
  const evalSelect = document.getElementById('autonomous-eval-agent');
  if (!evalSelect) return;
  const previousValue = String(evalSelect.value || '').trim();

  replaceSelectOptions(evalSelect, buildAutonomousAgentOptions('evaluate'));

  const nextValue = String(preferredValue || previousValue || '').trim();
  if (nextValue && AUTONOMOUS_AGENT_IDS.includes(nextValue)) {
    evalSelect.value = nextValue;
  }
}

function updateAutonomousReviewOptions(preferredValue) {
  const reviewSelect = document.getElementById('autonomous-review-agent');
  if (!reviewSelect) return;
  const previousValue = String(reviewSelect.value || '').trim();
  const selectedAgents = getAutonomousSelectedAgents();

  replaceSelectOptions(reviewSelect, buildAutonomousAgentOptions('review', {
    includeNone: true,
    noneLabel: 'none',
    selectedAgents
  }));

  const nextValue = preferredValue !== undefined
    ? String(preferredValue || '').trim()
    : previousValue;
  if (!nextValue) {
    reviewSelect.value = '';
    return;
  }
  if (AUTONOMOUS_AGENT_IDS.includes(nextValue)) {
    reviewSelect.value = nextValue;
    return;
  }
  reviewSelect.value = AUTONOMOUS_AGENT_IDS.find(agentId => !selectedAgents.includes(agentId)) || '';
}

function updateAutonomousModeControls(options) {
  const opts = options || {};
  const selectedAgents = getAutonomousSelectedAgents();
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

  updateAutonomousEvalOptions(opts.evalAgent);
  updateAutonomousReviewOptions(opts.reviewAgent);
  evalSelect.disabled = isSolo;
  reviewSelect.disabled = !isSolo;

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

  replaceSelectOptions(stopAfter, stopOptions);
  const preferredStop = String(opts.stopAfter || previousStop || 'close').trim();
  if (stopOptions.some(opt => opt.value === preferredStop)) {
    stopAfter.value = preferredStop;
    return;
  }
  stopAfter.value = stopOptions.some(opt => opt.value === previousStop) ? previousStop : 'close';
}

async function submitAutonomousModal() {
  if (!autonomousModalFeature) return;
  const current = collectAutonomousModalState();
  const selectedAgents = current.agents;
  if (selectedAgents.length === 0) {
    showToast('Select at least one implementation agent', null, null, { error: true });
    return;
  }

  if (current.stopAfter === 'review' && !current.reviewAgent) {
    showToast('Select a reviewer to stop after review', null, null, { error: true });
    return;
  }

  const featureId = autonomousModalFeature.id;
  const repoPath = autonomousModalRepoPath;
  const btn = autonomousModalBtn;
  hideAutonomousModal();
  await requestFeatureAutonomousRun(featureId, {
    agents: selectedAgents,
    evalAgent: current.evalAgent,
    reviewAgent: current.reviewAgent,
    stopAfter: current.stopAfter
  }, repoPath, btn);
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('autonomous-modal');
  if (!modal) return;

  document.getElementById('autonomous-modal-cancel').onclick = () => hideAutonomousModal();
  document.getElementById('autonomous-save-workflow').onclick = () => saveAutonomousWorkflow();
  modal.onclick = (e) => { if (e.target === e.currentTarget) hideAutonomousModal(); };
  document.getElementById('autonomous-modal-submit').onclick = () => submitAutonomousModal();
  modal.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'autonomous-workflow-select') {
      applyAutonomousWorkflowSelection(e.target.value);
      return;
    }
    if (e.target && e.target.closest('#autonomous-agent-checks')) {
      updateAutonomousModeControls();
    }
  });
});
