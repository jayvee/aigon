/* dashboard-esm-processed */

import { fetchSpecRecommendation, showConfirm, showDangerConfirm, tripletsToCliArgs } from './actions-picker.js';
import { showAgentPicker } from './sidebar.js';
import { requestAction, requestFeatureOpen, requestRefresh, requestSpecReviewLaunch } from './api.js';
import { budgetWarningForAgents, fetchBudget } from './budget-widget.js';
import { hasCloseFailure } from './store.js';
import { escHtml, formatFeatureIdForDisplay, showToast } from './utils.js';
// ── F519: actions.js compatibility shell ─────────────────────────────────────
// Card-level button rendering + lazy-loaded action modules. Picker/triplet
// helpers live in actions-picker.js; budget widget in budget-widget.js.

const ACTION_MODULE_BY_ACTION = {
  'feature-start': 'start',
  'research-start': 'start',
  'feature-autopilot': 'start',
  'feature-eval': 'eval',
  'research-eval': 'eval',
  'feature-code-review': 'review',
  'research-review': 'review',
  'feature-close': 'close',
  'feature-resolve-and-close': 'close',
  'feature-spec-review': 'spec-review',
  'feature-spec-revise': 'spec-review',
  'research-spec-review': 'spec-review',
  'research-spec-revise': 'spec-review',
  'feature-autonomous-start': 'autonomous',
  'feature-autonomous-stop': 'autonomous',
  'autonomous-recover': 'recovery',
  'feature-cancel-code-review': 'recovery',
  'research-cancel-code-review': 'recovery',
  'feature-schedule': 'schedule-kickoff',
  'research-schedule': 'schedule-kickoff',
  'feature-nudge': 'nudge',
  'research-nudge': 'nudge',
  'feature-pause': 'pause',
  'research-pause': 'pause',
  'feature-delete': 'delete',
  'research-delete': 'delete',
  'feature-reset': 'reset',
  'research-reset': 'reset',
};

const SET_ACTION_PREFIX = 'set-';

const _actionModuleCache = new Map();
const _actionModuleLoading = new Map();

function buildActionContext(va, feature, repoPath, btn, pipelineType, extras) {
  return Object.assign({
    va,
    feature,
    repoPath,
    btn,
    pipelineType,
    helpers: {
      escHtml,
      showToast,
      showConfirm,
      showDangerConfirm,
      requestAction,
      requestFeatureOpen,
      requestSpecReviewLaunch,
      requestRefresh,
      showAgentPicker,
      fetchSpecRecommendation,
      tripletsToCliArgs,
      fetchBudget,
      budgetWarningForAgents,
    },
    api: { requestAction, requestFeatureOpen, requestRefresh },
  }, extras || {});
}

async function loadActionModule(moduleName) {
  if (_actionModuleCache.has(moduleName)) return _actionModuleCache.get(moduleName);
  if (_actionModuleLoading.has(moduleName)) return _actionModuleLoading.get(moduleName);
  const promise = import('/js/actions/' + moduleName + '.js')
    .then((mod) => {
      if (typeof mod.init === 'function') mod.init();
      _actionModuleCache.set(moduleName, mod);
      _actionModuleLoading.delete(moduleName);
      return mod;
    })
    .catch((err) => {
      _actionModuleLoading.delete(moduleName);
      throw err;
    });
  _actionModuleLoading.set(moduleName, promise);
  return promise;
}

function restoreButtonState(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
  if (btn.dataset.aigonOrigLabel) {
    btn.textContent = btn.dataset.aigonOrigLabel;
    delete btn.dataset.aigonOrigLabel;
  }
}

function markButtonBusy(btn) {
  if (!btn || btn.disabled) return;
  if (!btn.dataset.aigonOrigLabel) btn.dataset.aigonOrigLabel = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
}

async function dispatchActionModule(moduleName, ctx) {
  markButtonBusy(ctx.btn);
  try {
    const mod = await loadActionModule(moduleName);
    if (typeof mod.open !== 'function') throw new Error('Action module missing open(): ' + moduleName);
    await mod.open(ctx);
  } catch (err) {
    console.error('[actions] failed to load/run module', moduleName, err);
    showToast('Action failed to load. Try refreshing the page.', null, null, { error: true });
    throw err;
  } finally {
    restoreButtonState(ctx.btn);
    document.querySelectorAll('.modal-backdrop').forEach((el) => {
      if (el.id && el.id.endsWith('-modal') && !el.hasAttribute('data-hidden')) return;
    });
  }
}

function renderActionButtons(feature, repoPath, pipelineType) {
  const validActions = feature.validActions || [];
  if (validActions.length === 0) return '';
  const showRecoveryActions = Boolean(feature && feature.__showRecoveryActions);

  const evalRunning = feature.evalSession && feature.evalSession.running;
  const hasSelectWinner = validActions.some(va => va.action === 'select-winner');
  const buttonsToRender = validActions.filter(va => {
    if (va.action === 'select-winner') return false;
    if (va.agentId) return false;
    if (va.category === 'infra' || va.category === 'view') return false;
    if (!showRecoveryActions && va.metadata && va.metadata.recoverySurface) return true;
    if (!showRecoveryActions && va.metadata && va.metadata.recovery) return false;
    if (!showRecoveryActions && (va.action === 'feature-cancel-code-review' || va.action === 'research-cancel-code-review')) return false;
    if (!showRecoveryActions && va.action === 'feature-autonomous-stop') return false;
    if (evalRunning && (va.action === 'feature-eval' || va.action === 'research-eval' || va.action === 'feature-code-review')) return false;
    return true;
  });
  if (hasSelectWinner) {
    buttonsToRender.push({ action: 'feature-close', label: 'Close', priority: 'high' });
  }

  const seen = new Set();
  const deduped = [];
  for (const va of buttonsToRender) {
    const key = va.action + (va.agentId || '');
    if (!seen.has(key)) { seen.add(key); deduped.push(va); }
  }

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

  const evalPickWinner = feature.evalStatus === 'pick winner' && feature.winnerAgent;
  const primary = [];
  const secondary = [];
  const overflow = [];

  deduped.forEach((va) => {
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

  function actionLabel(va) {
    if (va.action === 'feature-close' && (hasSelectWinner || evalPickWinner)) {
      return 'Pick & Close';
    }
    return va.label;
  }

  function actionBtnClass(va, baseCls) {
    if (va.action === 'feature-cancel-code-review' || va.action === 'research-cancel-code-review') {
      return 'btn btn-danger';
    }
    return baseCls;
  }

  function renderBtn(va, cls) {
    cls = actionBtnClass(va, cls);
    const agentAttr = va.agentId ? ' data-agent="' + escHtml(va.agentId) + '"' : '';
    const isBlocked = (va.action === 'feature-start') && feature.blockedBy && feature.blockedBy.length > 0;
    const isResearchEvalInFlight = va.action === 'research-close' && (
      ((feature.agents || []).some(a => a && a.awaitingInput && a.awaitingInput.message))
      || (feature.evalSession && feature.evalSession.running)
    );
    const disabledReason = va.disabledReason || '';
    const titleAttr = disabledReason ? ' title="' + escHtml(disabledReason) + '"' : '';
    if (isBlocked) {
      const blockedIds = feature.blockedBy.map(d => '#' + formatFeatureIdForDisplay(d.id)).join(', ');
      const waitCls = cls.indexOf('btn-primary') !== -1 ? 'btn btn-secondary kcard-va-btn kcard-start-pending-deps' : cls + ' kcard-start-pending-deps';
      return '<button class="' + waitCls + '" data-va-action="' + escHtml(va.action) + '"' + agentAttr + ' disabled title="Start unlocks when these are done: ' + escHtml(blockedIds) + '">' + escHtml(actionLabel(va)) + '</button>';
    }
    if (isResearchEvalInFlight) {
      const softCls = cls.indexOf('btn-primary') !== -1 ? 'btn btn-secondary kcard-va-btn' : cls + ' kcard-va-btn';
      return '<button class="' + softCls + '" data-va-action="' + escHtml(va.action) + '"' + agentAttr + ' title="Eval may still be running. Make sure the agent has finished creating features before closing.">' + escHtml(actionLabel(va)) + '</button>';
    }
    return '<button class="' + cls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '"' + agentAttr + (va.disabled ? ' disabled' : '') + titleAttr + '>' + escHtml(actionLabel(va)) + '</button>';
  }

  let html = '';
  primary.forEach(va => { html += renderBtn(va, 'btn btn-primary'); });
  secondary.forEach(va => { html += renderBtn(va, 'btn btn-secondary'); });

  if (hasCloseFailure(String(feature.id))) {
    html += '<button class="btn btn-secondary kcard-close-resolve-btn">Close with agent</button>';
  }

  if (overflow.length > 0) {
    const items = overflow.map(va => {
      if (va._reviewSession) {
        return '<button class="kcard-overflow-item" data-view-review="' + escHtml(va._reviewSession) + '">' + escHtml(va._reviewLabel) + '</button>';
      }
      const agentAttr = va.agentId ? ' data-agent="' + escHtml(va.agentId) + '"' : '';
      const isDanger = va.action === 'feature-stop' || va.action === 'research-stop' || va.action === 'feature-reset'
        || va.action === 'set-autonomous-stop' || va.action === 'set-autonomous-reset'
        || va.action === 'feature-cancel-code-review' || va.action === 'research-cancel-code-review';
      const cls = isDanger ? 'kcard-overflow-item kcard-va-btn btn-danger' : 'kcard-overflow-item kcard-va-btn';
      const disabledReason = va.disabledReason || '';
      return '<button class="' + cls + '" data-va-action="' + escHtml(va.action) + '"' + agentAttr
        + (va.disabled ? ' disabled' : '')
        + (disabledReason ? ' title="' + escHtml(disabledReason) + '"' : '')
        + '>' + escHtml(actionLabel(va)) + '</button>';
    }).join('');
    html += '<div class="kcard-overflow"><button class="btn btn-overflow kcard-overflow-toggle" type="button">⋯</button><div class="kcard-overflow-menu">' + items + '</div></div>';
  }

  return html;
}

async function handleFeatureAction(va, feature, repoPath, btn, pipelineType) {
  const id = feature.id;
  const agentId = va.agentId || null;
  const ctx = buildActionContext(va, feature, repoPath, btn, pipelineType);

  function pCmd(action) {
    const prefix = pipelineType === 'research' ? 'research' : pipelineType === 'feedback' ? 'feedback' : 'feature';
    return prefix + '-' + action;
  }

  const moduleName = ACTION_MODULE_BY_ACTION[va.action];
  if (moduleName) {
    try {
      await dispatchActionModule(moduleName, ctx);
    } catch (_) { /* toast already shown */ }
    return;
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
    case 'feature-unprioritise':
    case 'research-unprioritise': {
      const unprioCmd = va.action === 'research-unprioritise' ? 'research-unprioritise' : 'feature-unprioritise';
      const entityLabel = pipelineType === 'research' ? 'research topic' : 'feature';
      const msg = (va.metadata && va.metadata.confirmationMessage)
        || (`Move this ${entityLabel} back to the inbox? It will use a slug filename until you prioritise again.`);
      const ok = await window.showConfirm({
        title: 'Move #' + id + (feature.name ? ' — ' + feature.name : '') + ' to inbox?',
        message: msg,
        confirmLabel: 'Move to inbox',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
      await requestAction(unprioCmd, [id], repoPath, btn);
      break;
    }
    case 'feature-prioritise':
    case 'research-prioritise':
      await requestAction(pCmd('prioritise'), [feature.name], repoPath, btn);
      break;
    case 'select-winner':
      await requestAction('feature-close', [id, agentId], repoPath, btn);
      break;
    case 'feature-stop':
    case 'research-stop':
      await requestAction(va.action, [id, ...(agentId ? [agentId] : [])], repoPath, btn);
      break;
    case 'feature-code-revise':
      await requestAction('feature-code-revise', [id], repoPath, btn);
      break;
    case 'feature-push': {
      const msg = (va.metadata && va.metadata.confirmationMessage)
        || 'Push feature branch to origin?';
      const ok = await window.showConfirm({
        title: 'Push feature #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
        message: msg,
        confirmLabel: 'Push',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
      await requestAction('feature-push', [id], repoPath, btn);
      break;
    }
    case 'drop-agent':
    case 'agent-resume':
      await requestAction(va.action, [id, ...(agentId ? [agentId] : [])], repoPath, btn);
      break;
    default:
      if (va.mode === 'agent') {
        try {
          await dispatchActionModule('review', ctx);
        } catch (_) { /* toast shown */ }
      } else {
        await requestAction(va.action, [id, ...(agentId ? [agentId] : [])], repoPath, btn);
      }
  }
}

async function handleSetAction(va, setCard, repoPath, btn) {
  const ctx = buildActionContext(va, { id: setCard && setCard.slug, name: setCard && setCard.slug }, repoPath, btn, 'features', { setCard });
  if (String(va.action || '').startsWith(SET_ACTION_PREFIX) || va.action === 'set-prioritise' || va.action === 'feature-set-spec-review' || va.action === 'feature-set-spec-revise') {
    try {
      await dispatchActionModule('set-autonomous', ctx);
    } catch (_) { /* toast shown */ }
    return;
  }
  const slug = String(setCard && setCard.slug || '');
  if (!slug) return;
  await requestAction(va.action, [slug], repoPath, btn);
}

function showNudgeModal(feature, repoPath, btn, entityType) {
  const ctx = buildActionContext(
    { action: entityType === 'research' ? 'research-nudge' : 'feature-nudge' },
    feature,
    repoPath,
    btn,
    entityType === 'research' ? 'research' : 'features',
    { entityType: entityType || 'feature' }
  );
  loadActionModule('nudge')
    .then((mod) => mod.open(ctx))
    .catch((err) => {
      console.error('[actions] nudge module load failed', err);
      showToast('Nudge dialog failed to load', null, null, { error: true });
    });
}

// ── ESM exports (F623) ──
export { handleFeatureAction, handleSetAction, renderActionButtons, showNudgeModal };
