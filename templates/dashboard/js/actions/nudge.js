
import * as H from './shared.js';
/** F519 action module: nudge */

let nudgeModalFeature = null;
let nudgeModalRepoPath = null;
let nudgeModalBtn = null;
let nudgeModalEntityType = 'feature';

function getNudgeCandidates(feature) {
  const agents = Array.isArray(feature && feature.agents) ? feature.agents : [];
  const reviewSessions = Array.isArray(feature && feature.reviewSessionSummary)
    ? feature.reviewSessionSummary
    : (Array.isArray(feature && feature.reviewSessions) ? feature.reviewSessions : []);

  const reviewCandidates = reviewSessions
    .filter(s => s && s.agent && s.running)
    .map(s => ({ id: s.agent, tmuxRunning: true, role: 'review' }));

  const runningImpl = agents.filter(a => a && a.id && a.tmuxRunning && a.id !== 'solo');
  const allImpl = agents.filter(a => a && a.id && a.id !== 'solo');
  const implCandidates = (runningImpl.length > 0 ? runningImpl : allImpl)
    .map(a => ({ ...a, role: a.role || 'do' }));

  const all = [...reviewCandidates, ...implCandidates];
  const seen = new Set();
  return all.filter(c => {
    const key = c.id + ':' + (c.role || 'do');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderNudgeHistory(feature) {
  const box = document.getElementById('nudge-modal-history');
  if (!box) return;
  const nudges = Array.isArray(feature && feature.nudges) ? feature.nudges.slice().reverse() : [];
  if (nudges.length === 0) {
    box.innerHTML = '<div class="nudge-empty">No nudges sent yet.</div>';
    return;
  }
  box.innerHTML = nudges.map((nudge) => {
    const when = nudge.atISO ? new Date(nudge.atISO).toLocaleString() : '';
    const role = nudge.role ? ' · ' + H.escHtml(nudge.role) : '';
    return '<div class="nudge-history-card">' +
      '<div class="nudge-history-meta">' + H.escHtml((nudge.agentId || 'agent') + role + (when ? ' · ' + when : '')) + '</div>' +
      '<div class="nudge-history-msg">' + H.escHtml(nudge.message || '') + '</div></div>';
  }).join('');
}

function showNudgeModal(feature, repoPath, btn, entityType) {
  nudgeModalFeature = feature;
  nudgeModalRepoPath = repoPath;
  nudgeModalBtn = btn || null;
  nudgeModalEntityType = entityType || 'feature';
  const modal = document.getElementById('nudge-modal');
  const desc = document.getElementById('nudge-modal-desc');
  const agentSelect = document.getElementById('nudge-modal-agent');
  const roleSelect = document.getElementById('nudge-modal-role');
  const messageInput = document.getElementById('nudge-modal-message');
  if (!modal || !desc || !agentSelect || !roleSelect || !messageInput) return;

  const names = H.getAgentDisplayNames();
  desc.textContent = '#' + feature.id + ' ' + feature.name;
  const candidates = getNudgeCandidates(feature);
  H.replaceSelectOptions(agentSelect, candidates.map(agent => ({
    value: agent.id,
    label: agent.id + ' · ' + (names[agent.id] || agent.id),
    role: agent.role || 'do',
  })));
  agentSelect.onchange = function() {
    const sel = agentSelect.options[agentSelect.selectedIndex];
    if (sel && sel.dataset.role) roleSelect.value = sel.dataset.role;
  };
  if (candidates.length > 0) {
    agentSelect.value = candidates[0].id;
    roleSelect.value = candidates[0].role || 'do';
  } else {
    agentSelect.value = '';
    roleSelect.value = 'do';
  }
  messageInput.value = '';
  renderNudgeQuickItems(nudgeModalEntityType);
  renderNudgeHistory(feature);
  modal.removeAttribute('data-hidden');
  window.setTimeout(() => messageInput.focus(), 0);
}

function renderNudgeQuickItems(entityType) {
  const box = document.getElementById('nudge-modal-quick');
  if (!box) return;
  const isResearch = entityType === 'research';
  const items = isResearch
    ? [
        { label: 'research stuck', signal: 'research-complete', message: 'Complete your research now, write up your findings, then run: aigon agent-status research-complete (do not add any extra arguments — this marks YOUR slot complete)' },
      ]
    : [
        { label: 'implementation stuck', signal: 'implementation-complete', message: 'Complete the implementation now, then run: aigon agent-status implementation-complete' },
        { label: 'code review stuck', signal: 'review-complete', message: 'Please complete the code review now. Write up your findings and run: aigon agent-status review-complete' },
        { label: 'revision stuck', signal: 'revision-complete', message: 'Complete the revision addressing all review feedback, then run: aigon agent-status revision-complete' },
      ];
  const rowClass = 'nudge-quick-row';
  box.innerHTML = items.map((item, i) =>
    '<div class="' + rowClass + '" data-quick-nudge-index="' + i + '">' +
    '<span class="nudge-quick-label">' + H.escHtml(item.label) + '</span>' +
    '<span class="nudge-quick-signal">' + H.escHtml(item.signal) + '</span>' +
    '</div>'
  ).join('');
  box.querySelectorAll('[data-quick-nudge-index]').forEach(el => {
    const idx = parseInt(el.getAttribute('data-quick-nudge-index'), 10);
    el.addEventListener('mouseenter', () => { el.style.borderColor = 'var(--border-default)'; });
    el.addEventListener('mouseleave', () => { el.style.borderColor = ''; });
    el.onclick = () => {
      const input = document.getElementById('nudge-modal-message');
      if (input) input.value = items[idx].message;
    };
  });
}

function hideNudgeModal() {
  const modal = document.getElementById('nudge-modal');
  if (modal) modal.setAttribute('data-hidden', '');
  nudgeModalFeature = null;
  nudgeModalRepoPath = null;
  nudgeModalBtn = null;
  nudgeModalEntityType = 'feature';
}

async function submitNudgeModal() {
  if (!nudgeModalFeature) return;
  const agentSelect = document.getElementById('nudge-modal-agent');
  const roleSelect = document.getElementById('nudge-modal-role');
  const messageInput = document.getElementById('nudge-modal-message');
  const agentId = String(agentSelect && agentSelect.value || '').trim();
  const role = String(roleSelect && roleSelect.value || 'do').trim() || 'do';
  const message = String(messageInput && messageInput.value || '');
  if (!message.trim()) {
    H.showToast('Enter a nudge message', null, null, { error: true });
    return;
  }
  if (!agentId) {
    H.showToast('Select an agent', null, null, { error: true });
    return;
  }
  const featureId = nudgeModalFeature.id;
  const repoPath = nudgeModalRepoPath;
  const btn = nudgeModalBtn;
  const entityType = nudgeModalEntityType;
  hideNudgeModal();
  if (entityType === 'research') {
    await H.requestResearchNudge(featureId, { agentId, role, message }, repoPath, btn);
  } else {
    await H.requestFeatureNudge(featureId, { agentId, role, message }, repoPath, btn);
  }
}

let nudgeInitDone = false;
export function init() {
  if (nudgeInitDone) return;
  nudgeInitDone = true;
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
}

export async function open(ctx) {
  init();
  const entityType = ctx.entityType || (ctx.va && ctx.va.action === 'research-nudge' ? 'research' : 'feature');
  showNudgeModal(ctx.feature, ctx.repoPath, ctx.btn, entityType);
}

export function close() {
  hideNudgeModal();
}

// Global compat for pipeline.js direct calls
if (typeof window !== 'undefined') {
  window.__aigonShowNudgeModal = showNudgeModal;
}
