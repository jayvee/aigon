// ── Unified action renderer + dispatcher ────────────────────────────────────
// Single source of truth for feature/research/feedback action buttons.
// Both Monitor and Pipeline views call these functions instead of maintaining
// their own rendering logic.

const AIGON_AGENTS = Array.isArray(window.__AIGON_AGENTS__) ? window.__AIGON_AGENTS__ : [];
const AGENT_DISPLAY_NAMES = AIGON_AGENTS.reduce((map, agent) => {
  map[agent.id] = agent.displayName || agent.id;
  map.solo = 'Agent';
  return map;
}, {});
const AGENT_SHORT_NAMES = AIGON_AGENTS.reduce((map, agent) => {
  map[agent.id] = agent.shortName || String(agent.id || '').toUpperCase();
  map.solo = 'Drive';
  return map;
}, {});

function getAutonomousAgentIds() {
  return AIGON_AGENTS.filter(agent => agent.autonomousEligible !== false).map(agent => agent.id);
}

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
  // Triplet rows append <select>s for model/effort. A single outer <label>
  // would associate with the checkbox only (first labelable descendant), so
  // clicks on the selects toggled the checkbox instead of opening the picker
  // (REGRESSION: OpenCode GLM row felt "unselectable" in Fleet/autonomous UI).
  const useTripletShell = !!opts.tripletGrid;
  const rowEl = createEl(useTripletShell ? 'div' : 'label', { className: 'agent-check-row' });
  if (opts.rowClassName) rowEl.className += ' ' + opts.rowClassName;
  if (opts.tripletGrid) rowEl.classList.add('agent-check-row-triplet');

  const inputAttrs = {
    type: opts.type || 'checkbox',
    value: opts.value || '',
    name: opts.name || null,
    id: null,
  };
  if (opts.tripletGrid) {
    const prefix = opts.tripletCheckboxIdPrefix || 'triplet';
    const safeVal = String(opts.value || 'x').replace(/[^a-zA-Z0-9_-]/g, '') || 'x';
    inputAttrs.id = `${prefix}-cb-${safeVal}`;
  } else if (opts.id) {
    inputAttrs.id = opts.id;
  }
  const input = createEl('input', { attrs: inputAttrs });
  if (opts.checked) input.checked = true;
  if (opts.inputClassName) input.className = opts.inputClassName;

  if (opts.tripletGrid) {
    const primaryLabel = createEl('label', {
      className: 'agent-check-primary',
      attrs: inputAttrs.id ? { for: inputAttrs.id } : {},
    });
    primaryLabel.appendChild(input);
    const meta = createEl('span', { className: 'agent-check-meta' });
    meta.appendChild(createEl('span', { className: 'agent-check-label', text: opts.label || '' }));
    if (opts.hint) meta.appendChild(createEl('span', { className: 'agent-check-hint', text: opts.hint }));
    primaryLabel.appendChild(meta);
    rowEl.appendChild(primaryLabel);
    rowEl.appendChild(createEl('span', { className: 'agent-check-config-model', attrs: { 'aria-label': 'Configured model (from settings)' } }));
  } else {
    rowEl.appendChild(input);
    rowEl.appendChild(createEl('span', { className: 'agent-check-label', text: opts.label || '' }));
    if (opts.hint) rowEl.appendChild(createEl('span', { className: 'agent-check-hint', text: opts.hint }));
    if (opts.model) rowEl.appendChild(createEl('span', { className: 'agent-check-model', text: opts.model }));
  }
  return rowEl;
}

function appendTripletPlaceholder(title) {
  const span = createEl('span', {
    className: 'agent-triplet-placeholder',
    attrs: { title: title || 'Not configurable for this agent' }
  });
  span.textContent = '—';
  span.addEventListener('click', e => e.stopPropagation());
  return span;
}

function buildTripletPickerHeaderRow() {
  const header = createEl('div', { className: 'agent-picker-triplet-header-row', attrs: { 'aria-hidden': 'true' } });
  const thAgent = createEl('span', { className: 'agent-picker-th-agent' });
  thAgent.appendChild(createEl('span', { className: 'agent-picker-th-gutter' }));
  thAgent.appendChild(createEl('span', { className: 'agent-picker-th', text: 'Agent' }));
  header.appendChild(thAgent);
  header.appendChild(createEl('span', { className: 'agent-picker-th agent-picker-th-config', text: 'Configured model' }));
  header.appendChild(createEl('span', { className: 'agent-picker-th agent-picker-th-override', text: 'Model override' }));
  header.appendChild(createEl('span', { className: 'agent-picker-th agent-picker-th-override', text: 'Effort override' }));
  return header;
}

// Feature 313: recommendation for the currently-open agent picker.
// Shape: { complexity, agents: { <id>: { model, effort, modelSource, effortSource } } }
// Pre-selects dropdowns; user can still override.
let pickerRecommendation = null;
function setPickerRecommendation(rec) { pickerRecommendation = rec || null; }

function getRecommendedValue(agentId, field) {
  if (!pickerRecommendation || !pickerRecommendation.agents) return null;
  const entry = pickerRecommendation.agents[agentId];
  if (!entry) return null;
  return entry[field] == null ? null : String(entry[field]);
}

// Append model + effort controls for triplet-grid rows. Always emits two
// columns (select or placeholder) so the agent-picker grid stays aligned.
function appendTripletSelects(rowEl, agent) {
  if (!agent) return;
  rowEl.querySelectorAll('.agent-triplet-cell').forEach(n => n.remove());
  const modelOpts = Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  const cellModel = createEl('span', { className: 'agent-triplet-cell agent-triplet-cell-model' });
  if (modelOpts.length > 0) {
    const sel = document.createElement('select');
    sel.className = 'agent-triplet-model';
    sel.dataset.agentId = agent.id;
    modelOpts.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value == null ? '' : String(opt.value);
      const raw = opt.label || (opt.value == null ? '' : String(opt.value));
      el.textContent = opt.value == null && (!raw || raw === 'Use config default') ? 'Default' : (raw || String(opt.value));
      sel.appendChild(el);
    });
    const recommended = getRecommendedValue(agent.id, 'model');
    const stored = tripletStorage.read(agent.id);
    if (recommended && modelOpts.some(o => String(o.value || '') === recommended)) {
      sel.value = recommended;
      sel.classList.add('agent-triplet-recommended');
    } else if (stored.model != null && modelOpts.some(o => String(o.value || '') === stored.model)) {
      sel.value = stored.model;
    }
    const complexityHint = pickerRecommendation && pickerRecommendation.complexity
      ? ' Suggested for ' + pickerRecommendation.complexity + ' complexity (from the spec).'
      : '';
    sel.title = recommended && sel.classList.contains('agent-triplet-recommended') && complexityHint
      ? complexityHint.trim() + ' Default keeps your global aigon model for this task type.'
      : recommended && sel.classList.contains('agent-triplet-recommended')
        ? 'Suggested from spec. Default keeps your global aigon model for this task type.'
        : 'Default: use the model from aigon config for this task type';
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      e.stopPropagation();
      sel.classList.remove('agent-triplet-recommended');
      tripletStorage.write(agent.id, { model: sel.value || null });
    });
    cellModel.appendChild(sel);
  } else {
    cellModel.appendChild(appendTripletPlaceholder('No per-run model override for this agent'));
  }
  rowEl.appendChild(cellModel);

  const effortOpts = Array.isArray(agent.effortOptions) ? agent.effortOptions : [];
  const cellEffort = createEl('span', { className: 'agent-triplet-cell agent-triplet-cell-effort' });
  if (effortOpts.length > 0) {
    const sel = document.createElement('select');
    sel.className = 'agent-triplet-effort';
    sel.dataset.agentId = agent.id;
    effortOpts.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value == null ? '' : String(opt.value);
      const raw = opt.label || (opt.value == null ? '' : String(opt.value));
      el.textContent = opt.value == null && (!raw || raw === 'Use config default') ? 'Default' : (raw || String(opt.value));
      sel.appendChild(el);
    });
    const recommendedEffort = getRecommendedValue(agent.id, 'effort');
    const stored = tripletStorage.read(agent.id);
    if (recommendedEffort && effortOpts.some(o => String(o.value || '') === recommendedEffort)) {
      sel.value = recommendedEffort;
      sel.classList.add('agent-triplet-recommended');
    } else if (stored.effort != null && effortOpts.some(o => String(o.value || '') === stored.effort)) {
      sel.value = stored.effort;
    }
    const effortComplexityHint = pickerRecommendation && pickerRecommendation.complexity
      ? ' Suggested for ' + pickerRecommendation.complexity + ' complexity (from the spec).'
      : '';
    sel.title = recommendedEffort && sel.classList.contains('agent-triplet-recommended') && effortComplexityHint
      ? effortComplexityHint.trim() + ' Default keeps your global aigon effort for this agent.'
      : recommendedEffort && sel.classList.contains('agent-triplet-recommended')
        ? 'Suggested from spec. Default keeps your global aigon effort for this agent.'
        : 'Default: use the effort level from aigon config for this agent';
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      e.stopPropagation();
      sel.classList.remove('agent-triplet-recommended');
      tripletStorage.write(agent.id, { effort: sel.value || null });
    });
    cellEffort.appendChild(sel);
  } else {
    cellEffort.appendChild(appendTripletPlaceholder('No per-run effort override for this agent'));
  }
  rowEl.appendChild(cellEffort);
}

function updateReviewerTripletSelects(agentId, scope = 'autonomous') {
  const prefix = scope === 'picker-set' ? 'agent-picker-review' : 'autonomous-review';
  const modelCell = document.getElementById(prefix + '-model-cell');
  const effortCell = document.getElementById(prefix + '-effort-cell');
  if (!modelCell || !effortCell) return;
  const agent = agentId ? AIGON_AGENTS.find(a => a.id === agentId) : null;
  const modelOpts = agent && Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  const effortOpts = agent && Array.isArray(agent.effortOptions) ? agent.effortOptions : [];

  modelCell.innerHTML = '';
  if (modelOpts.length > 0) {
    const sel = document.createElement('select');
    sel.id = prefix + '-model';
    sel.className = 'agent-triplet-model create-input';
    sel.style.cssText = 'padding:8px 10px;width:100%';
    modelOpts.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value == null ? '' : String(opt.value);
      const raw = opt.label || (opt.value == null ? '' : String(opt.value));
      el.textContent = opt.value == null ? 'Default' : (raw || String(opt.value));
      sel.appendChild(el);
    });
    modelCell.appendChild(sel);
  } else {
    modelCell.appendChild(appendTripletPlaceholder('No per-run model override for this agent'));
  }

  effortCell.innerHTML = '';
  if (effortOpts.length > 0) {
    const sel = document.createElement('select');
    sel.id = prefix + '-effort';
    sel.className = 'agent-triplet-effort create-input';
    sel.style.cssText = 'padding:8px 10px;width:100%';
    effortOpts.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value == null ? '' : String(opt.value);
      const raw = opt.label || (opt.value == null ? '' : String(opt.value));
      el.textContent = opt.value == null ? 'Default' : (raw || String(opt.value));
      sel.appendChild(el);
    });
    effortCell.appendChild(sel);
  } else {
    effortCell.appendChild(appendTripletPlaceholder('No per-run effort override for this agent'));
  }
}

// Convert picker triplets → --models / --efforts CLI flags. Omits a
// pair entirely when both are null (so the CLI default applies).
function tripletsToCliArgs(triplets) {
  const models = [];
  const efforts = [];
  (triplets || []).forEach(t => {
    if (t.model) models.push(t.id + '=' + t.model);
    if (t.effort) efforts.push(t.id + '=' + t.effort);
  });
  const args = [];
  if (models.length > 0) args.push('--models=' + models.join(','));
  if (efforts.length > 0) args.push('--efforts=' + efforts.join(','));
  return args;
}

// Last-used triplet persistence — keyed per agent; defaults restored when
// picker reopens so users don't re-select "opus-4-7 + xhigh" every time.
const tripletStorage = {
  storageKey(agentId) { return 'aigon:picker-triplet:' + agentId; },
  read(agentId) {
    try {
      const raw = localStorage.getItem(this.storageKey(agentId));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  },
  write(agentId, patch) {
    try {
      const current = this.read(agentId);
      const next = Object.assign({}, current, patch);
      localStorage.setItem(this.storageKey(agentId), JSON.stringify(next));
    } catch (_) { /* non-fatal */ }
  }
};

// Feature 313: shared helpers for the complexity + recommendation UX.
const COMPLEXITY_LABEL_CLASS = {
  'low': 'complexity-low',
  'medium': 'complexity-medium',
  'high': 'complexity-high',
  'very-high': 'complexity-very-high',
};

function complexityBadgeHtml(complexity) {
  if (!complexity || !COMPLEXITY_LABEL_CLASS[complexity]) return '';
  return '<span class="complexity-badge ' + COMPLEXITY_LABEL_CLASS[complexity] + '" title="Complexity rating from spec frontmatter">' + complexity + '</span>';
}

// Render a banner summarising spec complexity and per-agent recommended {model, effort}.
// mountId: agent picker (#agent-picker-recommendation) or autonomous modal (#autonomous-picker-recommendation).
// REGRESSION: must not use a phantom .modal-card mount (banner was never shown before 2026-04).
function renderPickerRecommendationBanner(recommendation, mountId) {
  const banner = document.getElementById(mountId || 'agent-picker-recommendation');
  if (!banner) return;
  if (!recommendation || (!recommendation.complexity && (!recommendation.agents || Object.values(recommendation.agents).every(a => !a.model && !a.effort)))) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.style.display = '';
  const agentBits = [];
  Object.entries(recommendation.agents || {}).forEach(([id, entry]) => {
    if (!entry || (!entry.model && !entry.effort)) return;
    const modelLabel = entry.model || 'default';
    const effortLabel = entry.effort ? '/' + entry.effort : '';
    agentBits.push('<span class="recommendation-agent"><b>' + id + '</b> ' + modelLabel + effortLabel + '</span>');
  });
  let html = '';
  if (recommendation.complexity) {
    html += '<div class="recommendation-head"><span class="recommendation-label">Spec complexity</span> '
      + complexityBadgeHtml(recommendation.complexity) + '</div>';
    html += '<p class="recommendation-explainer">Suggestions combine spec complexity with your aigon defaults—keep <strong>Default</strong> or override, then Start.</p>';
  }
  if (agentBits.length > 0) {
    html += '<div class="recommendation-agents-line"><span class="recommendation-label">Resolved defaults</span> '
      + agentBits.join(' · ') + '</div>';
  }
  banner.innerHTML = html;
}

// Feature 313: fetch the spec-frontmatter recommendation for an entity.
// Returns the `resolved` payload (with per-agent fallback chain applied) or null.
async function fetchSpecRecommendation(type, id, repoPath) {
  try {
    const url = '/api/recommendation/' + encodeURIComponent(type) + '/' + encodeURIComponent(id)
      + (repoPath ? '?repoPath=' + encodeURIComponent(repoPath) : '');
    const res = await fetch(url, { headers: { 'accept': 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.resolved ? body.resolved : null;
  } catch (_) { return null; }
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
  if (action === 'feature-stop' || action === 'research-stop' || action === 'feature-reset' || action === 'research-reset'
    || action === 'set-autonomous-stop' || action === 'set-autonomous-reset') return 'btn btn-danger';
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
    if (evalRunning && (va.action === 'feature-eval' || va.action === 'research-eval' || va.action === 'feature-code-review')) return false;
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
    const isBlocked = (va.action === 'feature-start') && feature.blockedBy && feature.blockedBy.length > 0;
    const disabledReason = va.disabledReason || '';
    const titleAttr = disabledReason ? ' title="' + escHtml(disabledReason) + '"' : '';
    if (isBlocked) {
      const blockedIds = feature.blockedBy.map(d => '#' + formatFeatureIdForDisplay(d.id)).join(', ');
      const waitCls = cls.indexOf('btn-primary') !== -1 ? 'btn btn-secondary kcard-va-btn kcard-start-pending-deps' : cls + ' kcard-start-pending-deps';
      return '<button class="' + waitCls + '" data-va-action="' + escHtml(va.action) + '"' + agentAttr + ' disabled title="Start unlocks when these are done: ' + escHtml(blockedIds) + '">' + escHtml(actionLabel(va)) + '</button>';
    }
    return '<button class="' + cls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '"' + agentAttr + (va.disabled ? ' disabled' : '') + titleAttr + '>' + escHtml(actionLabel(va)) + '</button>';
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

  // "Close with agent" — shown persistently after a failed close
  if (state.closeFailedFeatures && state.closeFailedFeatures.has(String(feature.id))) {
    html += '<button class="btn btn-secondary kcard-close-resolve-btn">Close with agent</button>';
  }

  // Overflow dropdown
  if (overflow.length > 0) {
    const items = overflow.map(va => {
      // Special: review session link
      if (va._reviewSession) {
        return '<button class="kcard-overflow-item" data-view-review="' + escHtml(va._reviewSession) + '">' + escHtml(va._reviewLabel) + '</button>';
      }
      const agentAttr = va.agentId ? ' data-agent="' + escHtml(va.agentId) + '"' : '';
      const isDanger = va.action === 'feature-stop' || va.action === 'research-stop' || va.action === 'feature-reset'
        || va.action === 'set-autonomous-stop' || va.action === 'set-autonomous-reset';
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
    if (action === 'feature-code-review' || action === 'research-review') return 'review';
    return 'do';
  }

  async function launchAgentAction(action, options) {
    const implAgents = (feature.agents || []).map(a => a.id);
    const picked = await showAgentPicker(id, feature.name, {
      single: true,
      collectTriplet: true,
      title: options.title,
      submitLabel: options.submitLabel,
      implementingAgents: implAgents,
      repoPath,
      taskType: options.taskType,
      action
    });
    if (!picked || picked.length === 0) return;
    const t = picked[0];
    const launchOpts = {};
    if (t.model) launchOpts.model = t.model;
    if (t.effort) launchOpts.effort = t.effort;
    if (options.setupAction && feature.stage !== 'in-evaluation') {
      await requestAction(options.setupAction, [id, '--setup-only'], repoPath, btn);
    }
    await requestFeatureOpen(id, t.id, repoPath, null, pipelineType, getLaunchMode(action), launchOpts);
  }

  async function launchSpecReviewAction(endpoint, options) {
    const picked = await showAgentPicker(id, feature.name, {
      single: true,
      collectTriplet: true,
      title: options.title,
      submitLabel: options.submitLabel,
      preselect: options.preselect || null,
      repoPath,
      taskType: 'review',
      action: options.action
    });
    if (!picked || picked.length === 0) return;
    const t = picked[0];
    const launchOpts = {};
    if (t.model) launchOpts.model = t.model;
    if (t.effort) launchOpts.effort = t.effort;
    await requestSpecReviewLaunch(endpoint, id, t.id, repoPath, btn, launchOpts);
    await requestRefresh();
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
      const recEntity = va.action === 'research-start' ? 'research' : 'feature';
      const recommendation = await fetchSpecRecommendation(recEntity, id, repoPath);
      const triplets = await showAgentPicker(id, feature.name, { repoPath, taskType: 'implement', action: va.action, collectTriplet: true, recommendation });
      if (!triplets) return;
      const agentIds = triplets.map(t => t.id);
      // F322: warn if any selected agent has <20% remaining on a budget limit.
      try {
        if (typeof fetchBudget === 'function') {
          await fetchBudget();
          const warning = budgetWarningForAgents(agentIds);
          if (warning && !window.confirm(warning)) return;
        }
      } catch (_) { /* best-effort */ }
      const extraArgs = tripletsToCliArgs(triplets);
      await requestAction(pCmd('start'), [id, ...agentIds, ...extraArgs], repoPath, btn);
      break;
    }
    case 'feature-autonomous-start': {
      showAutonomousModal(feature, repoPath, btn);
      break;
    }
    case 'feature-autopilot': {
      const recommendation = await fetchSpecRecommendation('feature', id, repoPath);
      const triplets = await showAgentPicker(id, feature.name, { title: 'Select Autopilot Agents', submitLabel: 'Autopilot', repoPath, taskType: 'implement', action: va.action, collectTriplet: true, recommendation });
      if (!triplets) return;
      if (triplets.length < 2) { showToast('Select at least 2 agents for autopilot'); return; }
      const extraArgs = tripletsToCliArgs(triplets);
      const agentIds = triplets.map(t => t.id);
      await requestAction('feature-autopilot', [id, ...agentIds, ...extraArgs, '--auto-eval'], repoPath, btn);
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
    case 'feature-spec-review': {
      await launchSpecReviewAction('feature-spec-review', {
        title: 'Choose spec reviewer',
        submitLabel: 'Review Spec',
        action: va.action
      });
      break;
    }
    case 'feature-spec-review-check': {
      await launchSpecReviewAction('feature-spec-review-check', {
        title: 'Choose author agent',
        submitLabel: 'Check Spec Review',
        preselect: feature.authorAgentId || null,
        action: va.action
      });
      break;
    }
    case 'research-spec-review': {
      await launchSpecReviewAction('research-spec-review', {
        title: 'Choose spec reviewer',
        submitLabel: 'Review Spec',
        action: va.action
      });
      break;
    }
    case 'research-spec-review-check': {
      await launchSpecReviewAction('research-spec-review-check', {
        title: 'Choose author agent',
        submitLabel: 'Check Spec Review',
        preselect: feature.authorAgentId || null,
        action: va.action
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
    case 'feature-delete':
    case 'research-delete': {
      const deleteCmd = pipelineType === 'research' ? 'research-delete' : 'feature-delete';
      const entityLabel = pipelineType === 'research' ? 'research' : 'feature';
      let msg = va.metadata && va.metadata.confirmationMessage;
      if (msg && entityLabel === 'research' && /\bfeature\b/i.test(msg)) {
        msg = null;
      }
      if (!msg) {
        msg = 'Delete this ' + entityLabel + ' spec and its workflow state? This cannot be undone.';
      }
      const ok = await showDangerConfirm({
        title: 'Delete ' + entityLabel + ' #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
        message: msg,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await requestAction(deleteCmd, [id], repoPath, btn);
      break;
    }
    case 'feature-code-review-check':
      await requestAction('feature-code-review-check', [id], repoPath, btn);
      break;
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
    case 'feature-nudge':
      showNudgeModal(feature, repoPath, btn);
      break;
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

async function handleSetAction(va, setCard, repoPath, btn) {
  const slug = String(setCard && setCard.slug || '');
  if (!slug) return;

  switch (va.action) {
    case 'set-autonomous-start': {
      const pick = await showAgentPicker(slug, 'set ' + slug, {
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
      const triArgs = tripletsToCliArgs(triplets);
      const modelsCsv = (triArgs.find(a => a.startsWith('--models=')) || '').slice('--models='.length) || '';
      const effortsCsv = (triArgs.find(a => a.startsWith('--efforts=')) || '').slice('--efforts='.length) || '';
      const reviewAgent = String(pick.reviewAgent || '').trim();
      const reviewModel = String(pick.reviewModel || '').trim();
      const reviewEffort = String(pick.reviewEffort || '').trim();
      const mergedModels = [modelsCsv, reviewAgent && reviewModel ? (`${reviewAgent}:${reviewModel}`) : ''].filter(Boolean).join(',');
      const mergedEfforts = [effortsCsv, reviewAgent && reviewEffort ? (`${reviewAgent}:${reviewEffort}`) : ''].filter(Boolean).join(',');
      const args = [slug, ...agentIds, '--stop-after=close'];
      if (reviewAgent) args.push(`--review-agent=${reviewAgent}`);
      if (mergedModels) args.push(`--models=${mergedModels}`);
      if (mergedEfforts) args.push(`--efforts=${mergedEfforts}`);
      try {
        if (typeof fetchBudget === 'function') {
          await fetchBudget();
          const warning = budgetWarningForAgents([...agentIds, reviewAgent].filter(Boolean));
          if (warning && !window.confirm(warning)) return;
        }
      } catch (_) { /* best-effort */ }
      await requestAction('set-autonomous-start', args, repoPath, btn);
      break;
    }
    case 'set-autonomous-reset': {
      const message = (va.metadata && va.metadata.confirmationMessage)
        || ('Reset set "' + slug + '"? This clears the set conductor state file and any in-flight set session.');
      const ok = await showDangerConfirm({
        title: 'Reset set "' + slug + '"?',
        message,
        confirmLabel: 'Reset set',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await requestAction('set-autonomous-reset', [slug], repoPath, btn);
      break;
    }
    case 'set-autonomous-stop':
    case 'set-autonomous-resume':
      await requestAction(va.action, [slug], repoPath, btn);
      break;
    default:
      await requestAction(va.action, [slug], repoPath, btn);
  }
}

// ── Close modal logic ─────────────────────────────────────────────────────

let closeModalResolve = null;
let closeModalFeature = null;
let closeModalRepoPath = null;
let closeModalPipelineType = null;
let nudgeModalFeature = null;
let nudgeModalRepoPath = null;
let nudgeModalBtn = null;
let autonomousModalFeature = null;
let autonomousModalRepoPath = null;
let autonomousModalBtn = null;
let autonomousModalModels = null;
let autonomousModalWorkflowSlug = '';

const AUTONOMOUS_AGENT_IDS = getAutonomousAgentIds();

function getNudgeCandidates(feature) {
  const agents = Array.isArray(feature && feature.agents) ? feature.agents : [];
  const running = agents.filter(agent => agent && agent.id && agent.tmuxRunning);
  return (running.length > 0 ? running : agents).filter(agent => agent && agent.id && agent.id !== 'solo');
}

function renderNudgeHistory(feature) {
  const box = document.getElementById('nudge-modal-history');
  if (!box) return;
  const nudges = Array.isArray(feature && feature.nudges) ? feature.nudges.slice().reverse() : [];
  if (nudges.length === 0) {
    box.innerHTML = '<div style="font-size:12px;color:var(--text-secondary)">No nudges sent yet.</div>';
    return;
  }
  box.innerHTML = nudges.map((nudge) => {
    const when = nudge.atISO ? new Date(nudge.atISO).toLocaleString() : '';
    const role = nudge.role ? ' · ' + escHtml(nudge.role) : '';
    return '<div style="padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--bg-secondary);display:grid;gap:4px">' +
      '<div style="font-size:11px;color:var(--text-secondary)">' + escHtml((nudge.agentId || 'agent') + role + (when ? ' · ' + when : '')) + '</div>' +
      '<div style="white-space:pre-wrap;font-size:13px;line-height:1.4">' + escHtml(nudge.text || '') + '</div>' +
      '</div>';
  }).join('');
}

function showNudgeModal(feature, repoPath, btn) {
  nudgeModalFeature = feature;
  nudgeModalRepoPath = repoPath;
  nudgeModalBtn = btn || null;
  const modal = document.getElementById('nudge-modal');
  const desc = document.getElementById('nudge-modal-desc');
  const agentSelect = document.getElementById('nudge-modal-agent');
  const roleSelect = document.getElementById('nudge-modal-role');
  const messageInput = document.getElementById('nudge-modal-message');
  if (!modal || !desc || !agentSelect || !roleSelect || !messageInput) return;

  desc.textContent = '#' + feature.id + ' ' + feature.name;
  const candidates = getNudgeCandidates(feature);
  replaceSelectOptions(agentSelect, candidates.map(agent => ({
    value: agent.id,
    label: agent.id + ' · ' + (AGENT_DISPLAY_NAMES[agent.id] || agent.id)
  })));
  if (candidates.length === 1) agentSelect.value = candidates[0].id;
  else agentSelect.value = '';
  roleSelect.value = 'do';
  messageInput.value = '';
  renderNudgeHistory(feature);
  modal.style.display = 'flex';
  window.setTimeout(() => messageInput.focus(), 0);
}

function hideNudgeModal() {
  const modal = document.getElementById('nudge-modal');
  if (modal) modal.style.display = 'none';
  nudgeModalFeature = null;
  nudgeModalRepoPath = null;
  nudgeModalBtn = null;
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
    showToast('Enter a nudge message', null, null, { error: true });
    return;
  }
  if (!agentId) {
    showToast('Select an agent', null, null, { error: true });
    return;
  }
  const featureId = nudgeModalFeature.id;
  const repoPath = nudgeModalRepoPath;
  const btn = nudgeModalBtn;
  hideNudgeModal();
  await requestFeatureNudge(featureId, { agentId, role, message }, repoPath, btn);
}

function renderAgentPickerRows(options) {
  const opts = options || {};
  const collectTriplet = !!opts.collectTriplet;
  const checks = document.getElementById('agent-picker-checks');
  if (!checks) return;
  const rows = AIGON_AGENTS.map(agent => {
    const row = buildAgentCheckRow({
      value: agent.id,
      label: agent.id,
      hint: agent.displayName || agent.id,
      tripletGrid: collectTriplet,
      tripletCheckboxIdPrefix: collectTriplet ? 'agent-picker' : undefined,
    });
    if (collectTriplet) {
      row.dataset.agentId = agent.id;
      appendTripletSelects(row, agent);
    }
    return row;
  });
  if (collectTriplet) {
    replaceNodeChildren(checks, [buildTripletPickerHeaderRow(), ...rows]);
  } else {
    replaceNodeChildren(checks, rows);
  }
  checks.classList.toggle('agent-checks-triplet', collectTriplet);
}

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
  renderAgentPickerRows();
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

// ── Autonomous modal logic ────────────────────────────────────────────────

async function showAutonomousModal(feature, repoPath, btn) {
  autonomousModalFeature = feature;
  autonomousModalRepoPath = repoPath;
  autonomousModalBtn = btn || null;
  autonomousModalModels = await fetchAgentModels(repoPath).catch(() => ({}));

  const desc = document.getElementById('autonomous-modal-desc');
  const checks = document.getElementById('autonomous-agent-checks');
  const evalSelect = document.getElementById('autonomous-eval-agent');
  const reviewSelect = document.getElementById('autonomous-review-agent');
  const stopAfter = document.getElementById('autonomous-stop-after');
  const modal = document.getElementById('autonomous-modal');
  if (!desc || !checks || !evalSelect || !reviewSelect || !stopAfter || !modal) return;

  let autonomousRec = null;
  try {
    autonomousRec = await fetchSpecRecommendation('feature', String(feature.id), repoPath);
  } catch (_) { autonomousRec = null; }
  setPickerRecommendation(autonomousRec);
  renderPickerRecommendationBanner(autonomousRec, 'autonomous-picker-recommendation');

  desc.textContent = '';
  desc.appendChild(document.createTextNode('#' + feature.id + ' ' + (feature.name || '')));
  if (feature.set) {
    desc.appendChild(document.createElement('br'));
    const hint = document.createElement('span');
    hint.style.cssText = 'color:var(--text-secondary);font-size:12px;line-height:1.45';
    hint.textContent = 'Set "' + String(feature.set) + '": this workflow runs this feature only. To run every set member in order, use "Start set autonomously" on the set card (Monitor) or the set row in Pipeline (Group by Set).';
    desc.appendChild(hint);
  }
  const autoRows = AUTONOMOUS_AGENT_IDS.map(agentId => {
    const displayName = AGENT_DISPLAY_NAMES[agentId] || agentId;
    const modelName = (autonomousModalModels && autonomousModalModels[agentId] && autonomousModalModels[agentId].implement) || '';
    const agent = AIGON_AGENTS.find(a => a.id === agentId) || { id: agentId, modelOptions: [], effortOptions: [] };
    const row = buildAgentCheckRow({
      value: agentId,
      checked: agentId === (window.__AIGON_DEFAULT_AGENT__ || 'cc'),
      label: agentId,
      hint: displayName,
      tripletGrid: true,
      tripletCheckboxIdPrefix: 'autonomous',
    });
    row.dataset.agentId = agentId;
    appendTripletSelects(row, agent);
    const cfg = row.querySelector('.agent-check-config-model');
    if (cfg) cfg.textContent = modelName || '';
    return row;
  });
  replaceNodeChildren(checks, [buildTripletPickerHeaderRow(), ...autoRows]);
  checks.classList.add('agent-checks-triplet');

  stopAfter.value = 'close';
  updateAutonomousModeControls();
  try { await fetchBudget(true); } catch (_) { /* best-effort */ }
  updateAutonomousBudgetNotice();
  await populateAutonomousWorkflowDropdown(repoPath);
  modal.style.display = 'flex';
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
  replaceSelectOptions(select, options);
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
  updateReviewerTripletSelects(resolved.reviewAgent || '');
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
    showToast('Select at least one implementation agent before saving', null, null, { error: true });
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
    stages.push({ type: 'counter-review', agents: [selectedAgents[0]] });
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
      showToast('Save failed: ' + (data.error || res.statusText), null, null, { error: true });
      return;
    }
    showToast('Saved workflow "' + slug + '"');
    await populateAutonomousWorkflowDropdown(autonomousModalRepoPath);
    const select = document.getElementById('autonomous-workflow');
    if (select) select.value = slug;
  } catch (error) {
    showToast('Save failed: ' + error.message, null, null, { error: true });
  }
}

function hideAutonomousModal() {
  const modal = document.getElementById('autonomous-modal');
  if (modal) modal.style.display = 'none';
  setPickerRecommendation(null);
  renderPickerRecommendationBanner(null, 'autonomous-picker-recommendation');
  autonomousModalFeature = null;
  autonomousModalRepoPath = null;
  autonomousModalBtn = null;
  autonomousModalModels = null;
  autonomousModalWorkflowSlug = '';
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

/** Set autonomous: reviewer row on the same modal as implementers (agent-picker). */
function populateSetAgentPickerReviewerSection(repoPath, implementerIds) {
  const sel = document.getElementById('agent-picker-review-agent');
  if (!sel) return Promise.resolve();
  const setup = function(models) {
    const prev = autonomousModalModels;
    autonomousModalModels = models || {};
    replaceSelectOptions(sel, buildAutonomousAgentOptions('review', {
      includeNone: true,
      noneLabel: 'No code review (skip review step)',
      selectedAgents: Array.isArray(implementerIds) ? implementerIds : [],
    }));
    sel.value = '';
    sel.onchange = function() {
      updateReviewerTripletSelects(String(sel.value || '').trim(), 'picker-set');
    };
    updateReviewerTripletSelects('', 'picker-set');
    autonomousModalModels = prev;
  };
  if (typeof fetchAgentModels === 'function') {
    return fetchAgentModels(repoPath).then(setup).catch(function() { setup({}); });
  }
  setup({});
  return Promise.resolve();
}
if (typeof window !== 'undefined') window.populateSetAgentPickerReviewerSection = populateSetAgentPickerReviewerSection;

function updateAutonomousEvalOptions() {
  const evalSelect = document.getElementById('autonomous-eval-agent');
  if (!evalSelect) return;
  const previousValue = String(evalSelect.value || '').trim();

  evalSelect.disabled = false;
  replaceSelectOptions(evalSelect, buildAutonomousAgentOptions('evaluate'));

  if (previousValue && AUTONOMOUS_AGENT_IDS.includes(previousValue)) {
    evalSelect.value = previousValue;
  }
}

function updateAutonomousReviewOptions() {
  const reviewSelect = document.getElementById('autonomous-review-agent');
  if (!reviewSelect) return;
  const previousValue = String(reviewSelect.value || '').trim();
  const selectedAgents = [...document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]:checked')].map(cb => cb.value);

  reviewSelect.disabled = false;
  replaceSelectOptions(reviewSelect, buildAutonomousAgentOptions('review', {
    includeNone: true,
    noneLabel: 'none',
    selectedAgents
  }));

  if (previousValue && AUTONOMOUS_AGENT_IDS.includes(previousValue)) {
    reviewSelect.value = previousValue;
    updateReviewerTripletSelects(reviewSelect.value);
    return;
  }
  reviewSelect.value = AUTONOMOUS_AGENT_IDS.find(agentId => !selectedAgents.includes(agentId)) || '';
  updateReviewerTripletSelects(reviewSelect.value);
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

  replaceSelectOptions(stopAfter, stopOptions);
  stopAfter.value = stopOptions.some(opt => opt.value === previousStop) ? previousStop : 'close';
}

async function submitAutonomousModal() {
  if (!autonomousModalFeature) return;
  const selectedAgents = [...document.querySelectorAll('#autonomous-agent-checks input[type="checkbox"]:checked')].map(cb => cb.value);
  if (selectedAgents.length === 0) {
    showToast('Select at least one implementation agent', null, null, { error: true });
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
    showToast('Select a reviewer to stop after review', null, null, { error: true });
    return;
  }

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
  const triArgs = tripletsToCliArgs(triplets);
  const modelsCsv = (triArgs.find(a => a.startsWith('--models=')) || '').slice('--models='.length) || '';
  const effortsCsv = (triArgs.find(a => a.startsWith('--efforts=')) || '').slice('--efforts='.length) || '';

  // F322: warn if a selected agent is below 20% on any budget limit.
  try {
    if (typeof fetchBudget === 'function') {
      await fetchBudget();
      const warning = budgetWarningForAgents([...selectedAgents, evalAgent, reviewAgent].filter(Boolean));
      if (warning && !window.confirm(warning)) return;
    }
  } catch (_) { /* budget check is best-effort */ }

  const featureId = autonomousModalFeature.id;
  const repoPath = autonomousModalRepoPath;
  const btn = autonomousModalBtn;
  hideAutonomousModal();
  await requestFeatureAutonomousRun(featureId, {
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

document.addEventListener('DOMContentLoaded', () => {
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
      updateAutonomousBudgetNotice();
    });
  }
  const reviewAgentSelect = document.getElementById('autonomous-review-agent');
  if (reviewAgentSelect) {
    reviewAgentSelect.addEventListener('change', () => {
      updateReviewerTripletSelects(reviewAgentSelect.value);
      updateAutonomousBudgetNotice();
    });
  }
  const evalAgentSelect = document.getElementById('autonomous-eval-agent');
  if (evalAgentSelect) evalAgentSelect.addEventListener('change', () => updateAutonomousBudgetNotice());
  modal.addEventListener('change', (e) => {
    if (e.target && e.target.closest('#autonomous-agent-checks')) {
      updateAutonomousModeControls();
    }
    updateAutonomousBudgetNotice();
  });
});

// ── Agent budget widget (F322) ──────────────────────────────────────────────

const BUDGET_STALE_MS = 90 * 60 * 1000;
const BUDGET_WIDGET_HIDDEN_KEY = 'aigon:budget-widget-hidden';
const BUDGET_WIDGET_COLLAPSED_KEY = 'aigon:budget-widget-collapsed';
let _budgetCache = null;
let _budgetFetchPromise = null;

function budgetClassFor(pctRemaining, polledAt) {
  if (polledAt && Date.now() - new Date(polledAt).getTime() > BUDGET_STALE_MS) return 'budget-stale';
  if (pctRemaining == null || Number.isNaN(pctRemaining)) return 'budget-stale';
  if (pctRemaining < 20) return 'budget-red';
  if (pctRemaining < 50) return 'budget-amber';
  return 'budget-green';
}

function fetchBudget(force) {
  if (_budgetFetchPromise && !force) return _budgetFetchPromise;
  _budgetFetchPromise = fetch('/api/budget', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : { cc: null, cx: null, gg: null })
    .catch(() => ({ cc: null, cx: null, gg: null }))
    .then(data => { _budgetCache = data || { cc: null, cx: null, gg: null }; _budgetFetchPromise = null; return _budgetCache; });
  return _budgetFetchPromise;
}

function budgetWidgetCollapsed() {
  try {
    const v = localStorage.getItem(BUDGET_WIDGET_COLLAPSED_KEY);
    if (v === '1' || v === '0') return v === '1';
    if (localStorage.getItem(BUDGET_WIDGET_HIDDEN_KEY) === '1') {
      localStorage.removeItem(BUDGET_WIDGET_HIDDEN_KEY);
      localStorage.setItem(BUDGET_WIDGET_COLLAPSED_KEY, '1');
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

function setBudgetWidgetCollapsed(collapsed) {
  try {
    localStorage.setItem(BUDGET_WIDGET_COLLAPSED_KEY, collapsed ? '1' : '0');
    localStorage.removeItem(BUDGET_WIDGET_HIDDEN_KEY);
  } catch (_) { /* ignore */ }
}

function budgetAgentEnabled(agentId) {
  return AIGON_AGENTS.some(agent => agent.id === agentId);
}

function hasAnyBudgetData(data) {
  const entry = data || _budgetCache || {};
  return !!(entry.cc || entry.cx || entry.gg);
}

function collectBudgetPctValues(data) {
  const values = [];
  let polledAt = null;
  const touchPoll = iso => {
    if (!iso) return;
    if (!polledAt || new Date(iso) > new Date(polledAt)) polledAt = iso;
  };
  if (budgetAgentEnabled('cc') && data.cc) {
    touchPoll(data.cc.polled_at);
    [ccRemaining(data.cc.session), ccRemaining(data.cc.week_all),
      data.cc.week_sonnet ? ccRemaining(data.cc.week_sonnet) : null]
      .filter(v => v != null && Number.isFinite(v))
      .forEach(v => values.push(v));
  }
  if (budgetAgentEnabled('cx') && data.cx) {
    touchPoll(data.cx.polled_at);
    const fh = data.cx.five_hour && data.cx.five_hour.pct_remaining;
    const wk = data.cx.weekly && data.cx.weekly.pct_remaining;
    [fh, wk].filter(v => v != null && Number.isFinite(v)).forEach(v => values.push(v));
  }
  if (budgetAgentEnabled('gg') && data.gg && Array.isArray(data.gg.tiers)) {
    touchPoll(data.gg.polled_at);
    for (const t of data.gg.tiers) {
      if (t && t.pct_used != null) {
        const rem = 100 - t.pct_used;
        if (Number.isFinite(rem)) values.push(rem);
      }
    }
  }
  return { values, polledAt };
}

function budgetOverallSummaryClass(data) {
  const { values, polledAt } = collectBudgetPctValues(data);
  if (values.length === 0) return 'budget-stale';
  const worst = values.reduce((a, b) => Math.min(a, b), 100);
  return budgetClassFor(worst, polledAt);
}

function budgetOverallAriaLabel(summaryClass) {
  if (summaryClass === 'budget-red') return 'Overall quota headroom: low';
  if (summaryClass === 'budget-amber') return 'Overall quota headroom: moderate';
  if (summaryClass === 'budget-green') return 'Overall quota headroom: healthy';
  return 'Overall quota: stale or unavailable';
}

function budgetCollapsedSummaryLine(data) {
  const parts = [];
  for (const id of ['cc', 'cx', 'gg']) {
    if (!budgetAgentEnabled(id)) continue;
    const s = budgetSummaryForAgent(id, data[id]);
    parts.push(`${s.name}: ${s.summaryText}`);
  }
  return parts.join(' · ') || 'Waiting for usage data';
}

function buildBudgetStatusDot(summaryClass) {
  return createEl('span', {
    className: 'budget-status-dot ' + summaryClass,
    attrs: {
      role: 'img',
      'aria-label': budgetOverallAriaLabel(summaryClass),
    },
  });
}

function buildBudgetCollapseControl(collapsed) {
  const btn = createEl('button', {
    className: 'budget-collapse-btn',
    text: collapsed ? 'Expand' : 'Collapse',
    attrs: {
      type: 'button',
      'aria-expanded': collapsed ? 'false' : 'true',
      title: collapsed ? 'Show full quota details' : 'Collapse quota panel',
    },
  });
  btn.addEventListener('click', () => {
    setBudgetWidgetCollapsed(!budgetWidgetCollapsed());
    renderBudgetWidget();
  });
  return btn;
}

function fmtRelAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatBudgetDateLabel(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || undefined,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch (_) {
    return '';
  }
}

function parseBudgetClockTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = (m[3] || '').toLowerCase();
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour === 24) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function getZoneDateTimeParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);
    const map = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    let year = parseInt(map.year, 10);
    let month = parseInt(map.month, 10);
    let day = parseInt(map.day, 10);
    let hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);
    const period = String(map.dayPeriod || '').toLowerCase();
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return { year, month, day, hour, minute };
  } catch (_) {
    return null;
  }
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      hour: 'numeric',
    }).formatToParts(date);
    const zonePart = parts.find(part => part.type === 'timeZoneName');
    if (!zonePart) return null;
    const m = String(zonePart.value || '').match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
    if (!m) return null;
    const sign = m[1] === '+' ? 1 : -1;
    const hours = parseInt(m[2], 10);
    const minutes = m[3] ? parseInt(m[3], 10) : 0;
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return sign * (hours * 60 + minutes);
  } catch (_) {
    return null;
  }
}

function addLocalDays(parts, days) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function compareLocalDateTime(a, b) {
  const fields = ['year', 'month', 'day', 'hour', 'minute'];
  for (const field of fields) {
    const av = a[field];
    const bv = b[field];
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function zonedDateTimeToDate(parts, timeZone) {
  let utcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  for (let i = 0; i < 2; i += 1) {
    const offset = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
    if (offset == null) break;
    const adjusted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0) - (offset * 60000);
    if (adjusted === utcMs) break;
    utcMs = adjusted;
  }
  return new Date(utcMs);
}

function inferBudgetResetDate({ polledAt, resetsAt, timeZone, maxDays = 8 }) {
  const target = parseBudgetClockTime(resetsAt);
  if (!target || !polledAt || !timeZone) return null;
  const base = new Date(polledAt);
  if (Number.isNaN(base.getTime())) return null;
  const current = getZoneDateTimeParts(base, timeZone);
  if (!current) return null;

  // Best-effort estimate: search forward through the next few local days for a
  // matching wall clock time in the provider's timezone. This is enough to tell
  // the user whether a reset is "tomorrow" vs "in a few days" when the source
  // only exposes a time, not a full date.
  for (let i = 0; i < maxDays; i += 1) {
    const localDate = addLocalDays(current, i);
    const candidateLocal = {
      year: localDate.year,
      month: localDate.month,
      day: localDate.day,
      hour: target.hour,
      minute: target.minute,
    };
    if (compareLocalDateTime(candidateLocal, current) <= 0) continue;
    const candidate = zonedDateTimeToDate({
      year: localDate.year,
      month: localDate.month,
      day: localDate.day,
      hour: target.hour,
      minute: target.minute,
    }, timeZone);
    const parts = getZoneDateTimeParts(candidate, timeZone);
    if (
      parts
      && parts.year === localDate.year
      && parts.month === localDate.month
      && parts.day === localDate.day
      && parts.hour === target.hour
      && parts.minute === target.minute
    ) {
      return candidate;
    }
  }
  return null;
}

function buildBudgetResetLabel({ resetsAt, resetsDate, resetsAtEpoch, polledAt, timeZone }) {
  const time = String(resetsAt || '').trim();
  if (!time) return null;

  if (resetsAtEpoch != null && Number.isFinite(resetsAtEpoch)) {
    const exact = new Date(resetsAtEpoch * 1000);
    const dateLabel = formatBudgetDateLabel(exact);
    if (dateLabel) {
      return {
        text: `${dateLabel} · ${time}`,
        title: `Resets ${dateLabel} at ${time}`,
      };
    }
  }

  if (resetsDate) {
    return {
      text: `${resetsDate} · ${time}`,
      title: `Resets ${resetsDate} at ${time}`,
    };
  }

  const inferred = inferBudgetResetDate({ polledAt, resetsAt: time, timeZone });
  if (inferred) {
    const dateLabel = formatBudgetDateLabel(inferred, timeZone);
    if (dateLabel) {
      return {
        text: `est. ${dateLabel} · ${time}`,
        title: `Estimated from ${time} reset time in ${timeZone}`,
      };
    }
  }

  return {
    text: time,
    title: null,
  };
}

function buildBudgetMetric({ label, pctRemaining, resetsAt, resetsDate, resetsAtEpoch, timeZone, polledAt }) {
  const wrap = createEl('span', { className: 'budget-metric ' + budgetClassFor(pctRemaining, polledAt) });
  const bar = createEl('span', { className: 'budget-bar' });
  const fill = createEl('span', { className: 'budget-bar-fill' });
  const pct = Math.max(0, Math.min(100, Number.isFinite(pctRemaining) ? pctRemaining : 0));
  fill.style.width = pct + '%';
  bar.appendChild(fill);
  wrap.appendChild(bar);
  const pctText = pctRemaining == null ? '—' : pctRemaining + '%';
  wrap.appendChild(createEl('span', { className: 'budget-pct', text: pctText }));
  wrap.appendChild(createEl('span', { className: 'budget-label', text: label }));
  const resetLabel = buildBudgetResetLabel({ resetsAt, resetsDate, resetsAtEpoch, timeZone, polledAt });
  if (resetLabel) {
    wrap.appendChild(createEl('span', {
      className: 'budget-reset',
      text: '↻ ' + resetLabel.text,
      attrs: resetLabel.title ? { title: resetLabel.title } : {},
    }));
  }
  return wrap;
}

function budgetSupportText(agentId, entry) {
  if (agentId !== 'cx' || !entry) return '';
  const parts = [];
  if (entry.plan_type) parts.push(String(entry.plan_type).replace(/^\w/, c => c.toUpperCase()));
  if (entry.credits) {
    if (entry.credits.unlimited) parts.push('unlimited credits');
    else if (entry.credits.hasCredits) parts.push(`credits ${entry.credits.balance || ''}`.trim());
    else parts.push('no credits');
  }
  return parts.join(' · ');
}

function compactBudgetSummary(parts) {
  return parts
    .filter(part => part && part.value != null)
    .map(part => `${part.label} ${part.value}%`)
    .join(' · ') || 'usage unavailable';
}

function ccRemaining(entry) {
  if (!entry || entry.pct_used == null) return null;
  return 100 - entry.pct_used;
}

function budgetSummaryForAgent(agentId, entry) {
  const name = agentId === 'cc' ? 'Claude Code' : agentId === 'cx' ? 'Codex' : 'Gemini';
  if (!entry) {
    return {
      id: agentId,
      name,
      severity: 'muted',
      badge: 'Info',
      copy: 'Usage data is not available from the latest poll yet.',
      metrics: [],
      summaryText: 'usage unavailable',
      summaryClass: 'budget-stale',
    };
  }

  let metrics = [];
  let values = [];
  let summaryText = 'usage unavailable';
  if (agentId === 'gg') {
    if (!entry.tiers || !entry.tiers.length) {
      return {
        id: agentId,
        name,
        severity: 'muted',
        badge: 'Info',
        copy: 'Usage data is not available from the latest poll yet.',
        metrics: [],
        summaryText: 'usage unavailable',
        summaryClass: 'budget-stale',
      };
    }
    metrics = entry.tiers.map(t => ({
      label: (t.label || t.tier || 'tier') + ' remaining',
      pctRemaining: t.pct_used != null ? 100 - t.pct_used : null,
      resetsAt: t.resets_at || null,
      resetsDate: t.resets_date || null,
      resetsAtEpoch: t.resets_at_epoch || null,
      polledAt: entry.polled_at,
    }));
    values = metrics.map(m => m.pctRemaining).filter(v => v != null && Number.isFinite(v));
    summaryText = compactBudgetSummary(entry.tiers.map(t => ({
      label: t.label || t.tier || 'tier',
      value: t.pct_used != null ? 100 - t.pct_used : null,
    })));
  } else if (agentId === 'cc') {
    const sessionPct = ccRemaining(entry.session);
    const weekPct = ccRemaining(entry.week_all);
    const sonnetPct = ccRemaining(entry.week_sonnet);
    metrics = [
      {
        label: 'session remaining',
        pctRemaining: sessionPct,
        resetsAt: entry.session && entry.session.resets_at,
        timeZone: entry.session && entry.session.tz,
        polledAt: entry.polled_at,
      },
      {
        label: 'weekly remaining',
        pctRemaining: weekPct,
        resetsAt: entry.week_all && entry.week_all.resets_at,
        timeZone: entry.week_all && entry.week_all.tz,
        polledAt: entry.polled_at,
      },
    ];
    if (entry.week_sonnet) {
      metrics.push({
        label: 'sonnet remaining',
        pctRemaining: sonnetPct,
        resetsAt: entry.week_sonnet.resets_at,
        timeZone: entry.week_sonnet.tz,
        polledAt: entry.polled_at,
      });
    }
    values = [sessionPct, weekPct, sonnetPct].filter(v => v != null);
    summaryText = compactBudgetSummary([
      { label: 'session', value: sessionPct },
      { label: 'week', value: weekPct },
      { label: 'sonnet', value: sonnetPct },
    ]);
  } else {
    const fivePct = entry.five_hour && entry.five_hour.pct_remaining;
    const weeklyPct = entry.weekly && entry.weekly.pct_remaining;
    metrics = [
      {
        label: '5h remaining',
        pctRemaining: fivePct,
        resetsAt: entry.five_hour && entry.five_hour.resets_at,
        resetsDate: entry.five_hour && entry.five_hour.resets_date,
        resetsAtEpoch: entry.five_hour && entry.five_hour.resets_at_epoch,
        polledAt: entry.polled_at,
      },
      {
        label: 'weekly remaining',
        pctRemaining: weeklyPct,
        resetsAt: entry.weekly && entry.weekly.resets_at,
        resetsDate: entry.weekly && entry.weekly.resets_date,
        resetsAtEpoch: entry.weekly && entry.weekly.resets_at_epoch,
        polledAt: entry.polled_at,
      },
    ];
    values = [fivePct, weeklyPct].filter(v => v != null);
    summaryText = compactBudgetSummary([
      { label: '5h', value: fivePct },
      { label: 'week', value: weeklyPct },
    ]);
  }

  const worst = values.length > 0 ? values.reduce((a, b) => Math.min(a, b), 100) : null;
  const warning = worst != null && worst < 20;
  return {
    id: agentId,
    name,
    severity: warning ? 'warning' : 'info',
    badge: warning ? 'Warning' : 'Info',
    copy: warning
      ? `${name} is low on remaining quota. Lower percentages mean less room before the current limit window resets.`
      : `${name} has remaining quota available for this run.`,
    metrics,
    supportText: budgetSupportText(agentId, entry),
    summaryText,
    summaryClass: budgetClassFor(worst, entry.polled_at),
  };
}

function updatePickerBudgetNotice() {
  const notice = document.getElementById('agent-picker-budget-notice');
  if (notice) {
    notice.style.display = 'none';
    notice.replaceChildren();
  }
  annotateAgentPickerBudget();
}

function updateAutonomousBudgetNotice() {
  const notice = document.getElementById('autonomous-budget-notice');
  if (notice) {
    notice.style.display = 'none';
    notice.replaceChildren();
  }
  annotateAutonomousAgentBudget();
}

function renderBudgetWidget() {
  const el = document.getElementById('budget-widget');
  if (!el) return;
  const data = _budgetCache || { cc: null, cx: null, gg: null };
  const cc = data.cc;
  const cx = data.cx;
  const gg = data.gg;
  if (!hasAnyBudgetData(data)) {
    el.style.display = 'none';
    el.classList.remove('budget-widget--collapsed');
    return;
  }
  el.style.display = 'flex';
  const collapsed = budgetWidgetCollapsed();
  const overallClass = budgetOverallSummaryClass(data);
  if (collapsed) el.classList.add('budget-widget--collapsed');
  else el.classList.remove('budget-widget--collapsed');

  const children = [];

  const latest = [cc && cc.polled_at, cx && cx.polled_at, gg && gg.polled_at].filter(Boolean).sort().pop();
  const head = createEl('div', { className: 'budget-widget-head' });
  head.appendChild(buildBudgetStatusDot(overallClass));
  const headTitles = createEl('div', { className: 'budget-widget-head-titles' });
  headTitles.appendChild(createEl('span', { className: 'budget-widget-head-title', text: 'Agent Quota Usage' }));
  if (collapsed) {
    headTitles.appendChild(createEl('span', { className: 'budget-widget-head-summary', text: budgetCollapsedSummaryLine(data) }));
  }
  head.appendChild(headTitles);
  const headMeta = createEl('div', { className: 'budget-widget-head-meta' });
  if (collapsed) {
    if (latest) headMeta.appendChild(createEl('span', { className: 'budget-widget-head-updated', text: 'updated ' + fmtRelAgo(latest) }));
    const headRefresh = createEl('button', { className: 'budget-refresh', text: '↻', attrs: { title: 'Refresh budgets', 'aria-label': 'Refresh budgets' } });
    headRefresh.onclick = () => {
      headRefresh.classList.add('spinning');
      fetch('/api/budget/refresh', { method: 'POST' }).catch(() => {});
      setTimeout(() => { fetchBudget(true).then(renderBudgetWidget).finally(() => headRefresh.classList.remove('spinning')); }, 10000);
    };
    headMeta.appendChild(headRefresh);
  }
  headMeta.appendChild(buildBudgetCollapseControl(collapsed));
  head.appendChild(headMeta);
  children.push(head);

  if (collapsed) {
    replaceNodeChildren(el, children);
    return;
  }

  const agentsWrap = createEl('div', { className: 'budget-agents' });

  if (budgetAgentEnabled('cc')) {
    const row = createEl('span', { className: 'budget-agent' });
    const head = createEl('span', { className: 'budget-agent-head' });
    head.appendChild(createEl('span', { className: 'budget-agent-name', text: 'Claude Code' }));
    row.appendChild(head);
    if (cc) {
      const sessionPct = ccRemaining(cc.session);
      const weekPct = ccRemaining(cc.week_all);
      const sonnetPct = ccRemaining(cc.week_sonnet);
      row.appendChild(buildBudgetMetric({
        label: 'session remaining',
        pctRemaining: sessionPct,
        resetsAt: cc.session && cc.session.resets_at,
        timeZone: cc.session && cc.session.tz,
        polledAt: cc.polled_at,
      }));
      row.appendChild(buildBudgetMetric({
        label: 'weekly remaining',
        pctRemaining: weekPct,
        resetsAt: cc.week_all && cc.week_all.resets_at,
        timeZone: cc.week_all && cc.week_all.tz,
        polledAt: cc.polled_at,
      }));
      if (cc.week_sonnet) {
        row.appendChild(buildBudgetMetric({
          label: 'sonnet remaining',
          pctRemaining: sonnetPct,
          resetsAt: cc.week_sonnet.resets_at,
          timeZone: cc.week_sonnet.tz,
          polledAt: cc.polled_at,
        }));
      }
    } else {
      row.appendChild(createEl('span', { className: 'budget-unavailable', text: 'usage unavailable' }));
    }
    agentsWrap.appendChild(row);
  }
  if (budgetAgentEnabled('cx')) {
    const row = createEl('span', { className: 'budget-agent' });
    const head = createEl('span', { className: 'budget-agent-head' });
    head.appendChild(createEl('span', { className: 'budget-agent-name', text: 'Codex' }));
    const support = budgetSupportText('cx', cx);
    if (support) head.appendChild(createEl('span', { className: 'budget-agent-support', text: support }));
    row.appendChild(head);
    if (cx) {
      const fivePct = cx.five_hour ? cx.five_hour.pct_remaining : null;
      const weeklyPct = cx.weekly ? cx.weekly.pct_remaining : null;
      row.appendChild(buildBudgetMetric({
        label: '5h remaining',
        pctRemaining: fivePct,
        resetsAt: cx.five_hour && cx.five_hour.resets_at,
        resetsDate: cx.five_hour && cx.five_hour.resets_date,
        resetsAtEpoch: cx.five_hour && cx.five_hour.resets_at_epoch,
        polledAt: cx.polled_at,
      }));
      row.appendChild(buildBudgetMetric({
        label: 'weekly remaining',
        pctRemaining: weeklyPct,
        resetsAt: cx.weekly && cx.weekly.resets_at,
        resetsDate: cx.weekly && cx.weekly.resets_date,
        resetsAtEpoch: cx.weekly && cx.weekly.resets_at_epoch,
        polledAt: cx.polled_at,
      }));
    } else {
      row.appendChild(createEl('span', { className: 'budget-unavailable', text: 'usage unavailable' }));
    }
    agentsWrap.appendChild(row);
  }
  if (budgetAgentEnabled('gg')) {
    const row = createEl('span', { className: 'budget-agent' });
    const head = createEl('span', { className: 'budget-agent-head' });
    head.appendChild(createEl('span', { className: 'budget-agent-name', text: 'Gemini' }));
    row.appendChild(head);
    if (gg && Array.isArray(gg.tiers) && gg.tiers.length) {
      for (const t of gg.tiers) {
        const pctRem = t.pct_used != null ? 100 - t.pct_used : null;
        row.appendChild(buildBudgetMetric({
          label: (t.label || t.tier || 'tier') + ' remaining',
          pctRemaining: pctRem,
          resetsAt: t.resets_at || null,
          resetsDate: t.resets_date || null,
          resetsAtEpoch: t.resets_at_epoch || null,
          polledAt: gg.polled_at,
        }));
      }
    } else {
      row.appendChild(createEl('span', { className: 'budget-unavailable', text: 'usage unavailable' }));
    }
    agentsWrap.appendChild(row);
  }

  if (agentsWrap.childNodes.length) children.push(agentsWrap);

  const meta = createEl('span', { className: 'budget-meta' });
  if (latest) meta.appendChild(createEl('span', { text: 'updated ' + fmtRelAgo(latest) }));
  const refreshBtn = createEl('button', { className: 'budget-refresh', text: '↻', attrs: { title: 'Refresh budgets', 'aria-label': 'Refresh budgets' } });
  refreshBtn.onclick = () => {
    refreshBtn.classList.add('spinning');
    fetch('/api/budget/refresh', { method: 'POST' }).catch(() => {});
    setTimeout(() => { fetchBudget(true).then(renderBudgetWidget).finally(() => refreshBtn.classList.remove('spinning')); }, 10000);
  };
  meta.appendChild(refreshBtn);
  children.push(meta);

  replaceNodeChildren(el, children);
}

function annotateAgentPickerBudget() {
  const data = _budgetCache || { cc: null, cx: null, gg: null };
  const picker = document.getElementById('agent-picker');
  if (!picker || picker.style.display === 'none') return;
  const rows = picker.querySelectorAll('.agent-check-row');
  rows.forEach(row => {
    const cb = row.querySelector('input');
    if (!cb) return;
    const id = cb.value;
    if (id !== 'cc' && id !== 'cx' && id !== 'gg') return;
    const existing = row.querySelector('.agent-check-budget');
    if (existing) existing.remove();

    const summary = budgetSummaryForAgent(id, data[id]);
    const el = createEl('span', {
      className: 'agent-check-budget ' + summary.summaryClass,
      text: summary.summaryText + (summary.severity === 'warning' ? ' ⚠' : ''),
    });
    const target = row.querySelector('.agent-check-meta') || row;
    target.appendChild(el);
  });
}

/** Same compact per-row quota line as the Start agent picker (F322). */
function annotateAutonomousAgentBudget() {
  const data = _budgetCache || { cc: null, cx: null, gg: null };
  const modal = document.getElementById('autonomous-modal');
  if (!modal || modal.style.display === 'none') return;
  const rows = modal.querySelectorAll('#autonomous-agent-checks .agent-check-row');
  rows.forEach(row => {
    const cb = row.querySelector('input');
    if (!cb) return;
    const id = cb.value;
    if (id !== 'cc' && id !== 'cx' && id !== 'gg') return;
    const existing = row.querySelector('.agent-check-budget');
    if (existing) existing.remove();

    const summary = budgetSummaryForAgent(id, data[id]);
    const el = createEl('span', {
      className: 'agent-check-budget ' + summary.summaryClass,
      text: summary.summaryText + (summary.severity === 'warning' ? ' ⚠' : ''),
    });
    const target = row.querySelector('.agent-check-meta') || row;
    target.appendChild(el);
  });
}

function budgetWarningForAgents(agentIds) {
  if (!_budgetCache) return null;
  const warnings = [];
  for (const id of agentIds) {
    const entry = _budgetCache[id];
    if (!entry) continue;
    let worst = null;
    let label = '';
    if (id === 'cc') {
      const s = ccRemaining(entry.session);
      const w = ccRemaining(entry.week_all);
      if (s != null && s < 20) { worst = s; label = 'session window'; }
      if (w != null && w < 20 && (worst == null || w < worst)) { worst = w; label = 'weekly window'; }
    } else if (id === 'cx') {
      const fh = entry.five_hour && entry.five_hour.pct_remaining;
      const wk = entry.weekly && entry.weekly.pct_remaining;
      if (fh != null && fh < 20) { worst = fh; label = '5-hour window'; }
      if (wk != null && wk < 20 && (worst == null || wk < worst)) { worst = wk; label = 'weekly window'; }
    } else if (id === 'gg' && Array.isArray(entry.tiers)) {
      for (const t of entry.tiers) {
        const rem = t.pct_used != null ? 100 - t.pct_used : null;
        const tierLabel = t.label || t.tier || 'tier';
        if (rem != null && rem < 20 && (worst == null || rem < worst)) {
          worst = rem;
          label = `${tierLabel} window`;
        }
      }
    }
    if (worst != null) {
      const name = id === 'cc' ? 'Claude Code' : id === 'cx' ? 'Codex' : 'Gemini';
      warnings.push(`${name} has only ${worst}% remaining in its ${label}.`);
    }
  }
  return warnings.length > 0 ? warnings.join('\n') + '\n\nStart anyway?' : null;
}

document.addEventListener('DOMContentLoaded', () => {
  fetchBudget().then(renderBudgetWidget);
  // Refresh widget every 2 minutes to keep "updated Xmin ago" accurate and pick up fresh polls.
  setInterval(() => { fetchBudget(true).then(() => { renderBudgetWidget(); updatePickerBudgetNotice(); updateAutonomousBudgetNotice(); }); }, 2 * 60 * 1000);

  // Annotate agent picker rows whenever it is opened.
  const picker = document.getElementById('agent-picker');
  if (picker) {
    const observer = new MutationObserver(() => {
      if (picker.style.display === 'flex') {
        fetchBudget().then(() => { updatePickerBudgetNotice(); });
      }
    });
    observer.observe(picker, { attributes: true, attributeFilter: ['style'] });
    picker.addEventListener('change', () => { updatePickerBudgetNotice(); });
  }

  const autonomousModalEl = document.getElementById('autonomous-modal');
  if (autonomousModalEl) {
    const autoObs = new MutationObserver(() => {
      if (autonomousModalEl.style.display === 'flex') {
        fetchBudget().then(() => { updateAutonomousBudgetNotice(); });
      }
    });
    autoObs.observe(autonomousModalEl, { attributes: true, attributeFilter: ['style'] });
  }
});
