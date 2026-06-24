/** F519 action module: set-autonomous */
import * as H from './shared.js';

function buildRunAtHtml() {
  return '<div style="margin-bottom:12px">' +
    '<label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:6px;font-weight:600">Run at</label>' +
    '<input type="datetime-local" id="set-schedule-run-at" class="create-input" style="width:100%;padding:8px 10px" />' +
    '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px" id="set-schedule-tz-hint"></div>' +
    '</div>';
}

function setupRunAt(box) {
  const inp = box.querySelector('#set-schedule-run-at');
  const hint = box.querySelector('#set-schedule-tz-hint');
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

function getRunAt(box) {
  const val = String((box.querySelector('#set-schedule-run-at') || {}).value || '').trim();
  if (!val) return '';
  const off = new Date().getTimezoneOffset();
  const sign = off <= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const pad = n => String(n).padStart(2, '0');
  return val + ':00' + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

function showSetScheduleTimeModal(slug) {
  return new Promise((resolve) => {
    const existing = document.getElementById('set-schedule-modal');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'set-schedule-modal';
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    const box = document.createElement('div');
    box.className = 'modal-box agent-picker-modal-box';
    box.innerHTML = '<h3>Schedule set autonomous run</h3>' +
      '<p class="modal-desc">Set ' + H.escHtml(slug) + '</p>' +
      buildRunAtHtml() +
      '<p id="set-schedule-msg" class="settings-empty" style="display:none;margin:8px 0;color:var(--error)"></p>' +
      '<div class="modal-actions" style="margin-top:16px">' +
      '<button type="button" class="btn" id="set-schedule-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="set-schedule-submit">Add schedule</button>' +
      '</div>';

    const close = (value) => {
      backdrop.remove();
      resolve(value);
    };

    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    setupRunAt(box);

    box.querySelector('#set-schedule-cancel').onclick = () => close(null);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(null); };
    box.querySelector('#set-schedule-submit').onclick = () => {
      const msg = box.querySelector('#set-schedule-msg');
      const runAt = getRunAt(box);
      if (!runAt) {
        msg.textContent = 'Select a date and time';
        msg.style.display = 'block';
        return;
      }
      close(runAt);
    };
  });
}

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
      const mergedModels = [modelsCsv, reviewAgent && reviewModel ? (`${reviewAgent}=${reviewModel}`) : ''].filter(Boolean).join(',');
      const mergedEfforts = [effortsCsv, reviewAgent && reviewEffort ? (`${reviewAgent}=${reviewEffort}`) : ''].filter(Boolean).join(',');
      const args = [slug, ...agentIds, '--stop-after=close'];
      if (reviewAgent) args.push(`--review-agent=${reviewAgent}`);
      if (mergedModels) args.push(`--models=${mergedModels}`);
      if (mergedEfforts) args.push(`--efforts=${mergedEfforts}`);
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
    case 'set-autonomous-schedule': {
      const pick = await H.showAgentPicker(slug, 'set ' + slug, {
        title: 'Choose set agents',
        submitLabel: 'Continue',
        repoPath,
        taskType: 'implement',
        action: va.action,
        collectTriplet: true,
        includeSetReviewer: true,
      });
      if (!pick || !Array.isArray(pick.triplets) || pick.triplets.length === 0) return;
      const runAt = await showSetScheduleTimeModal(slug);
      if (!runAt) return;
      const triplets = pick.triplets;
      const agentIds = triplets.map(t => t.id);
      const triArgs = H.tripletsToCliArgs(triplets);
      const modelsCsv = (triArgs.find(a => a.startsWith('--models=')) || '').slice('--models='.length) || '';
      const effortsCsv = (triArgs.find(a => a.startsWith('--efforts=')) || '').slice('--efforts='.length) || '';
      const reviewAgent = String(pick.reviewAgent || '').trim();
      const reviewModel = String(pick.reviewModel || '').trim();
      const reviewEffort = String(pick.reviewEffort || '').trim();
      const mergedModels = [modelsCsv, reviewAgent && reviewModel ? (`${reviewAgent}=${reviewModel}`) : ''].filter(Boolean).join(',');
      const mergedEfforts = [effortsCsv, reviewAgent && reviewEffort ? (`${reviewAgent}=${reviewEffort}`) : ''].filter(Boolean).join(',');
      try {
        if (typeof H.fetchBudget === 'function') {
          await H.fetchBudget();
          const warning = H.budgetWarningForAgents([...agentIds, reviewAgent].filter(Boolean));
          if (warning && !window.confirm(warning)) return;
        }
      } catch (_) { /* best-effort */ }
      const payload = {
        agents: agentIds,
        stopAfter: 'close',
        reviewAgent: reviewAgent || undefined,
        models: mergedModels || undefined,
        efforts: mergedEfforts || undefined,
      };
      let processingToast = null;
      try {
        processingToast = H.showToast('Scheduling…', null, null, { processing: true });
        const res = await fetch('/api/schedule/add', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repoPath,
            kind: 'set_autonomous',
            entityId: slug,
            runAt,
            payload,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          H.showToast(data.error || res.statusText || 'Failed to schedule set', null, null, { error: true });
          return;
        }
        H.showToast('Scheduled set ' + slug);
        await H.requestRefresh();
      } catch (e) {
        H.showToast((e && e.message) || 'Failed to schedule set', null, null, { error: true });
      } finally {
        if (processingToast) processingToast.remove();
      }
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
    case 'feature-set-spec-review': {
      const pick = await H.showAgentPicker(slug, 'set ' + slug, {
        single: true,
        collectTriplet: true,
        title: 'Choose set spec reviewer',
        submitLabel: 'Review Set Specs',
        repoPath,
        taskType: 'review',
        action: va.action,
      });
      if (!pick || pick.length === 0) return;
      const t = pick[0];
      const triArgs = H.tripletsToCliArgs([t]);
      const args = [slug, t.id, ...triArgs];
      try {
        if (typeof H.fetchBudget === 'function') {
          await H.fetchBudget();
          const warning = H.budgetWarningForAgents([t.id]);
          if (warning && !window.confirm(warning)) return;
        }
      } catch (_) { /* best-effort */ }
      await H.requestAction('feature-set-spec-review', args, repoPath, btn);
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

