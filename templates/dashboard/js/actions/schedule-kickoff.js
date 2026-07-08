
import { defaultAgent } from '../injected.js';
import * as H from './shared.js';
/** F519 action module: schedule-kickoff */

// ── Schedule kickoff: datetime-local helpers ──

function skBuildRunAtHtml() {
  return '<div class="form-field">' +
    '<label class="form-label">Run at</label>' +
    '<input type="datetime-local" id="schedule-kickoff-run-at" class="create-input create-input--full" />' +
    '<div class="form-hint" id="schedule-kickoff-tz-hint"></div>' +
    '</div>';
}

function skSetupRunAt(box) {
  const inp = box.querySelector('#schedule-kickoff-run-at');
  const hint = box.querySelector('#schedule-kickoff-tz-hint');
  const d = new Date(Date.now() + 3600000);
  const pad = n => String(n).padStart(2, '0');
  inp.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = new Date().getTimezoneOffset();
  const sign = off <= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const tz = sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  if (hint) hint.textContent = 'Times in ' + tzName + ' (' + tz + ')';
}

function skGetRunAt(box) {
  const val = String((box.querySelector('#schedule-kickoff-run-at') || {}).value || '').trim();
  if (!val) return '';
  const off = new Date().getTimezoneOffset();
  const sign = off <= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const pad = n => String(n).padStart(2, '0');
  return val + ':00' + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

// ── Schedule kickoff modal (dashboard POST /api/schedule/add — parity with `aigon schedule add`) ──

async function openScheduleKickoffModal(entityType, feature, repoPath, btn) {
  const existing = document.getElementById('schedule-kickoff-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'schedule-kickoff-modal';
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'modal-box agent-picker-modal-box';

  const title = entityType === 'research' ? 'Schedule research start' : 'Schedule autonomous start';
  const entityLabel = entityType === 'research' ? 'Research' : 'Feature';
  const models = await H.fetchAgentModels(repoPath).catch(() => ({}));

  let scheduleKickoffBusy = false;

  function closeModal() {
    backdrop.remove();
  }

  function closeModalUnlessBusy() {
    if (scheduleKickoffBusy) return;
    closeModal();
  }

  function skBuildAgentOptions(taskType, opts) {
    const o = opts || {};
    const includeNone = !!o.includeNone;
    const noneLabel = o.noneLabel || 'none';
    const selectedAgents = Array.isArray(o.selectedAgents) ? o.selectedAgents : [];
    const rows = [];
    if (includeNone) rows.push({ value: '', label: noneLabel });
    H.getAutonomousAgentIdsList().forEach((agentId) => {
      const displayName = H.getAgentDisplayNames()[agentId] || agentId;
      const modelName = (models && models[agentId] && models[agentId][taskType]) || '';
      const sameAsImplementer = selectedAgents.includes(agentId);
      const suffix = sameAsImplementer ? ' · implementing' : '';
      const label = modelName
        ? (agentId + ' · ' + displayName + ' · ' + modelName + suffix)
        : (agentId + ' · ' + displayName + suffix);
      rows.push({ value: agentId, label });
    });
    return rows;
  }

  if (entityType === 'research') {
    box.innerHTML = '<h3 id="schedule-kickoff-title">' + H.escHtml(title) + '</h3>' +
      '<p class="modal-desc">' + H.escHtml(entityLabel) + ' #' + H.escHtml(String(feature.id)) + ' ' + H.escHtml(feature.name || '') + '</p>' +
      skBuildRunAtHtml() +
      '<div class="form-field">' +
      '<label class="form-label">Agents (optional — empty uses Drive)</label>' +
      '<div class="agent-checks" id="schedule-kickoff-research-agent-checks"></div>' +
      '</div>' +
      '<div class="form-field form-row-checks">' +
      '<label><input type="checkbox" id="schedule-kickoff-bg" /> Background</label>' +
      '<label><input type="checkbox" id="schedule-kickoff-fg" /> Foreground</label>' +
      '</div>' +
      '<p id="schedule-kickoff-msg" class="settings-empty schedule-kickoff-msg" data-hidden></p>' +
      '<div class="modal-actions modal-actions--spaced">' +
      '<button type="button" class="btn" id="schedule-kickoff-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="schedule-kickoff-submit">Add schedule</button>' +
      '</div>';
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    skSetupRunAt(box);

    const checks = box.querySelector('#schedule-kickoff-research-agent-checks');
    const rows = H.getAutonomousAgentIdsList().map((agentId) => {
      const displayName = H.getAgentDisplayNames()[agentId] || agentId;
      return H.buildAgentCheckRow({
        value: agentId,
        checked: false,
        label: agentId,
        hint: displayName,
      });
    });
    H.replaceNodeChildren(checks, rows);

    box.querySelector('#schedule-kickoff-cancel').onclick = closeModalUnlessBusy;
    backdrop.onclick = (e) => { if (e.target === backdrop) closeModalUnlessBusy(); };
    box.querySelector('#schedule-kickoff-submit').onclick = async () => {
      const msg = box.querySelector('#schedule-kickoff-msg');
      const submitBtn = box.querySelector('#schedule-kickoff-submit');
      const cancelBtn = box.querySelector('#schedule-kickoff-cancel');
      msg.setAttribute('data-hidden', '');
      const runAt = skGetRunAt(box);
      if (!runAt) { msg.textContent = 'Select a date and time'; msg.removeAttribute('data-hidden'); return; }
      const agents = [...box.querySelectorAll('#schedule-kickoff-research-agent-checks input[type="checkbox"]:checked')].map((c) => c.value);
      const background = box.querySelector('#schedule-kickoff-bg').checked;
      const foreground = box.querySelector('#schedule-kickoff-fg').checked;
      let processingToast = null;
      const origSubmitLabel = submitBtn.textContent;
      scheduleKickoffBusy = true;
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      submitBtn.innerHTML = '<span class="run-next-spinner"></span>' + H.escHtml(origSubmitLabel);
      processingToast = H.showToast('Scheduling…', null, null, { processing: true });
      try {
        const res = await fetch('/api/schedule/add', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repoPath,
            kind: 'research_start',
            entityId: String(feature.id),
            runAt,
            payload: { agents, background, foreground },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          msg.textContent = data.error || res.statusText || 'Failed';
          msg.removeAttribute('data-hidden');
          return;
        }
        H.showToast('Scheduled research #' + feature.id);
        closeModal();
        if (typeof requestRefresh === 'function') await H.requestRefresh();
      } catch (e) {
        msg.textContent = e.message || 'Failed';
        msg.removeAttribute('data-hidden');
      } finally {
        if (processingToast) processingToast.remove();
        scheduleKickoffBusy = false;
        if (backdrop.parentNode) {
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
          submitBtn.textContent = origSubmitLabel;
        }
      }
    };
    return;
  }

  box.innerHTML = '<h3 id="schedule-kickoff-title">' + H.escHtml(title) + '</h3>' +
    '<p class="modal-desc">' + H.escHtml(entityLabel) + ' #' + H.escHtml(String(feature.id)) + ' ' + H.escHtml(feature.name || '') + '</p>' +
    skBuildRunAtHtml() +
    '<div class="form-field">' +
    '<label class="form-label">Workflow (optional)</label>' +
    '<select id="schedule-kickoff-workflow" class="create-input create-input--full">' +
    '<option value="">(none)</option></select>' +
    '<div class="form-hint-secondary" id="schedule-kickoff-workflow-desc"></div>' +
    '</div>' +
    '<div class="form-field">' +
    '<label class="form-label">Implementation agents</label>' +
    '<div class="agent-checks" id="schedule-kickoff-agent-checks"></div>' +
    '</div>' +
    '<div id="schedule-kickoff-eval-wrap" class="form-field">' +
    '<label class="form-label">Evaluator</label>' +
    '<select id="schedule-kickoff-eval-agent" class="create-input create-input--full"></select>' +
    '</div>' +
    '<div id="schedule-kickoff-review-wrap" class="form-field">' +
    '<label class="form-label">Reviewer</label>' +
    '<div class="agent-picker-reviewer-grid">' +
    '<select id="schedule-kickoff-review-agent" class="create-input create-input--compact"></select>' +
    '<span id="schedule-kickoff-review-model-cell" class="agent-triplet-cell agent-triplet-cell-model"></span>' +
    '<span id="schedule-kickoff-review-effort-cell" class="agent-triplet-cell agent-triplet-cell-effort"></span>' +
    '</div></div>' +
    '<div class="form-field">' +
    '<label class="form-label">Stop after</label>' +
    '<select id="schedule-kickoff-stop-after" class="create-input create-input--full">' +
    '<option value="close">close (default)</option><option value="eval">eval</option><option value="review">review</option><option value="implement">implement</option></select>' +
    '</div>' +
    '<p id="schedule-kickoff-msg" class="settings-empty schedule-kickoff-msg" data-hidden></p>' +
    '<div class="modal-actions modal-actions--spaced">' +
    '<button type="button" class="btn" id="schedule-kickoff-cancel">Cancel</button>' +
    '<button type="button" class="btn btn-primary" id="schedule-kickoff-submit">Add schedule</button>' +
    '</div>';

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  skSetupRunAt(box);

  const wfSelect = box.querySelector('#schedule-kickoff-workflow');
  try {
    const q = repoPath ? ('?repo=' + encodeURIComponent(repoPath)) : '';
    const res = await fetch('/api/workflows' + q, { cache: 'no-store' });
    const data = res.ok ? await res.json() : { workflows: [] };
    const workflows = Array.isArray(data.workflows) ? data.workflows : [];
    workflows.forEach((def) => {
      const o = document.createElement('option');
      o.value = def.slug;
      const badge = def.source === 'built-in' ? ' ★' : (def.source === 'global' ? ' [global]' : '');
      o.textContent = def.slug + badge + ' — ' + (def.label || def.slug);
      wfSelect.appendChild(o);
    });
  } catch (_) { /* ignore */ }

  const checks = box.querySelector('#schedule-kickoff-agent-checks');
  const autoRows = H.getAutonomousAgentIdsList().map((agentId) => {
    const displayName = H.getAgentDisplayNames()[agentId] || agentId;
    const modelName = (models && models[agentId] && models[agentId].implement) || '';
    const agent = H.getAgents().find((a) => a.id === agentId) || { id: agentId, modelOptions: [], effortOptions: [] };
    const row = H.buildAgentCheckRow({
      value: agentId,
      checked: agentId === (defaultAgent || 'cc'),
      label: agentId,
      hint: displayName,
      tripletGrid: true,
      tripletCheckboxIdPrefix: 'sched-kick',
    });
    row.dataset.agentId = agentId;
    H.appendTripletSelects(row, agent);
    const cfg = row.querySelector('.agent-check-config-model');
    if (cfg) cfg.textContent = modelName || '';
    return row;
  });
  H.replaceNodeChildren(checks, [H.buildTripletPickerHeaderRow(), ...autoRows]);
  checks.classList.add('agent-checks-triplet');

  function skUpdateMode() {
    const selectedAgents = [...box.querySelectorAll('#schedule-kickoff-agent-checks input[type="checkbox"]:checked')].map((c) => c.value);
    const isSolo = selectedAgents.length === 1;
    const evalWrap = box.querySelector('#schedule-kickoff-eval-wrap');
    const reviewWrap = box.querySelector('#schedule-kickoff-review-wrap');
    const evalSelect = box.querySelector('#schedule-kickoff-eval-agent');
    const reviewSelect = box.querySelector('#schedule-kickoff-review-agent');
    const stopAfter = box.querySelector('#schedule-kickoff-stop-after');
    if (!evalWrap || !reviewWrap || !evalSelect || !reviewSelect || !stopAfter) return;

    const previousStop = String(stopAfter.value || 'close').trim();
    evalWrap.toggleAttribute('data-hidden', isSolo);
    reviewWrap.toggleAttribute('data-hidden', !isSolo);
    evalSelect.disabled = isSolo;
    reviewSelect.disabled = !isSolo;

    const prevEval = String(evalSelect.value || '').trim();
    H.replaceSelectOptions(evalSelect, skBuildAgentOptions('evaluate'));
    if (prevEval && H.getAutonomousAgentIdsList().includes(prevEval)) evalSelect.value = prevEval;

    const prevReview = String(reviewSelect.value || '').trim();
    H.replaceSelectOptions(reviewSelect, skBuildAgentOptions('review', {
      includeNone: true,
      noneLabel: 'none',
      selectedAgents,
    }));
    if (prevReview && H.getAutonomousAgentIdsList().includes(prevReview)) {
      reviewSelect.value = prevReview;
      H.updateReviewerTripletSelects(reviewSelect.value, 'schedule-kickoff');
    } else {
      reviewSelect.value = H.getAutonomousAgentIdsList().find((agentId) => !selectedAgents.includes(agentId)) || '';
      H.updateReviewerTripletSelects(reviewSelect.value, 'schedule-kickoff');
    }

    const stopOptions = isSolo
      ? [
        { value: 'close', label: 'close (default)' },
        { value: 'review', label: 'review' },
        { value: 'implement', label: 'implement' },
      ]
      : [
        { value: 'close', label: 'close (default)' },
        { value: 'eval', label: 'eval' },
        { value: 'implement', label: 'implement' },
      ];
    H.replaceSelectOptions(stopAfter, stopOptions);
    stopAfter.value = stopOptions.some((opt) => opt.value === previousStop) ? previousStop : 'close';
  }

  checks.addEventListener('change', (e) => {
    if (e.target && e.target.matches && e.target.matches('input[type="checkbox"]')) skUpdateMode();
  });
  const reviewAgentSelect = box.querySelector('#schedule-kickoff-review-agent');
  reviewAgentSelect.addEventListener('change', () => {
    H.updateReviewerTripletSelects(String(reviewAgentSelect.value || '').trim(), 'schedule-kickoff');
  });
  skUpdateMode();
  try { await H.fetchBudget(true); } catch (_) { /* best-effort */ }

  box.querySelector('#schedule-kickoff-cancel').onclick = closeModalUnlessBusy;
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModalUnlessBusy(); };

  box.querySelector('#schedule-kickoff-submit').onclick = async () => {
    const msg = box.querySelector('#schedule-kickoff-msg');
    const submitBtn = box.querySelector('#schedule-kickoff-submit');
    const cancelBtn = box.querySelector('#schedule-kickoff-cancel');
    msg.setAttribute('data-hidden', '');
    const runAt = skGetRunAt(box);
    if (!runAt) { msg.textContent = 'Select a date and time'; msg.removeAttribute('data-hidden'); return; }
    const selectedAgents = [...box.querySelectorAll('#schedule-kickoff-agent-checks input[type="checkbox"]:checked')].map((c) => c.value);
    if (selectedAgents.length === 0) {
      msg.textContent = 'Select at least one implementation agent';
      msg.removeAttribute('data-hidden');
      return;
    }
    const evalSelect = box.querySelector('#schedule-kickoff-eval-agent');
    const reviewSelect = box.querySelector('#schedule-kickoff-review-agent');
    const stopAfter = box.querySelector('#schedule-kickoff-stop-after');
    const evalAgent = evalSelect && !evalSelect.disabled ? String(evalSelect.value || '').trim() : '';
    const reviewAgent = reviewSelect && !reviewSelect.disabled ? String(reviewSelect.value || '').trim() : '';
    const reviewModelSel = box.querySelector('#schedule-kickoff-review-model');
    const reviewEffortSel = box.querySelector('#schedule-kickoff-review-effort');
    const reviewModel = reviewAgent && reviewModelSel ? String(reviewModelSel.value || '').trim() : '';
    const reviewEffort = reviewAgent && reviewEffortSel ? String(reviewEffortSel.value || '').trim() : '';
    const stopValue = stopAfter ? String(stopAfter.value || 'close').trim() : 'close';
    if (stopValue === 'review' && !reviewAgent) {
      msg.textContent = 'Select a reviewer when stopping after review';
      msg.removeAttribute('data-hidden');
      return;
    }
    const triplets = selectedAgents.map((id) => {
      const row = box.querySelector('#schedule-kickoff-agent-checks input[value="' + id + '"]');
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
    const modelsCsv = (triArgs.find((a) => a.startsWith('--models=')) || '').slice('--models='.length) || '';
    const effortsCsv = (triArgs.find((a) => a.startsWith('--efforts=')) || '').slice('--efforts='.length) || '';
    try {
      if (typeof H.fetchBudget === 'function') {
        await H.fetchBudget();
        const warning = H.budgetWarningForAgents([...selectedAgents, evalAgent, reviewAgent].filter(Boolean));
        if (warning && !window.confirm(warning)) return;
      }
    } catch (_) { /* best-effort */ }

    const workflowSlug = String(wfSelect.value || '').trim();
    const payload = {
      agents: selectedAgents,
      stopAfter: stopValue,
      evalAgent: evalAgent || undefined,
      reviewAgent: reviewAgent || undefined,
      models: modelsCsv || undefined,
      efforts: effortsCsv || undefined,
      reviewModel: reviewModel || undefined,
      reviewEffort: reviewEffort || undefined,
      workflow: workflowSlug || undefined,
    };
    let processingToast = null;
    const origSubmitLabel = submitBtn.textContent;
    scheduleKickoffBusy = true;
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    submitBtn.innerHTML = '<span class="run-next-spinner"></span>' + H.escHtml(origSubmitLabel);
    processingToast = H.showToast('Scheduling…', null, null, { processing: true });
    try {
      const res = await fetch('/api/schedule/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoPath,
          kind: 'feature_autonomous',
          entityId: String(feature.id),
          runAt,
          payload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = data.error || res.statusText || 'Failed';
        msg.removeAttribute('data-hidden');
        return;
      }
      H.showToast('Scheduled feature #' + feature.id);
      closeModal();
      if (typeof requestRefresh === 'function') await H.requestRefresh();
    } catch (e) {
      msg.textContent = e.message || 'Failed';
      msg.removeAttribute('data-hidden');
    } finally {
      if (processingToast) processingToast.remove();
      scheduleKickoffBusy = false;
      if (backdrop.parentNode) {
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        submitBtn.textContent = origSubmitLabel;
      }
    }
  };
}

// ── Autonomous modal logic ────────────────────────────────────────────────

export async function open(ctx) {
  const entityType = ctx.entityType || (ctx.va && String(ctx.va.action || '').startsWith('research') ? 'research' : 'feature');
  await openScheduleKickoffModal(entityType, ctx.feature, ctx.repoPath, ctx.btn);
}

