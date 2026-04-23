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
    sel.title = 'Default: use the model from aigon config for this task type';
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
    sel.title = 'Default: use the effort level from aigon config for this agent';
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

function updateReviewerTripletSelects(agentId) {
  const modelCell = document.getElementById('autonomous-review-model-cell');
  const effortCell = document.getElementById('autonomous-review-effort-cell');
  if (!modelCell || !effortCell) return;
  const agent = agentId ? AIGON_AGENTS.find(a => a.id === agentId) : null;
  const modelOpts = agent && Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  const effortOpts = agent && Array.isArray(agent.effortOptions) ? agent.effortOptions : [];

  modelCell.innerHTML = '';
  if (modelOpts.length > 0) {
    const sel = document.createElement('select');
    sel.id = 'autonomous-review-model';
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
    sel.id = 'autonomous-review-effort';
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

// Render a banner inside the agent picker modal summarising the spec
// complexity and per-agent recommended {model, effort}. Hides banner when
// recommendation is null.
function renderPickerRecommendationBanner(recommendation) {
  const modalCard = document.querySelector('#agent-picker .modal-card');
  if (!modalCard) return;
  let banner = document.getElementById('agent-picker-recommendation');
  if (!recommendation || (!recommendation.complexity && (!recommendation.agents || Object.values(recommendation.agents).every(a => !a.model && !a.effort)))) {
    if (banner) banner.style.display = 'none';
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'agent-picker-recommendation';
    banner.className = 'agent-picker-recommendation';
    const after = document.getElementById('agent-picker-desc');
    if (after && after.nextSibling) modalCard.insertBefore(banner, after.nextSibling);
    else modalCard.appendChild(banner);
  }
  banner.style.display = '';
  const parts = [];
  if (recommendation.complexity) parts.push('<span class="recommendation-label">Recommended:</span> complexity ' + complexityBadgeHtml(recommendation.complexity));
  else parts.push('<span class="recommendation-label">Recommended:</span>');
  const agentBits = [];
  Object.entries(recommendation.agents || {}).forEach(([id, entry]) => {
    if (!entry || (!entry.model && !entry.effort)) return;
    const modelLabel = entry.model || 'default';
    const effortLabel = entry.effort ? '/' + entry.effort : '';
    agentBits.push('<span class="recommendation-agent"><b>' + id + '</b> ' + modelLabel + effortLabel + '</span>');
  });
  if (agentBits.length > 0) parts.push(agentBits.join(' · '));
  banner.innerHTML = parts.join(' ');
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
      const blockedIds = feature.blockedBy.map(d => '#' + parseInt(d.id, 10)).join(', ');
      return '<button class="' + cls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '"' + agentAttr + ' disabled title="Blocked by ' + escHtml(blockedIds) + '">' + escHtml(actionLabel(va)) + '</button>';
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
    case 'set-autonomous-start':
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

  desc.textContent = '#' + feature.id + ' ' + feature.name;
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
    workflowSelect.addEventListener('change', (e) => applyAutonomousWorkflow(String(e.target.value || '').trim()));
  }
  const reviewAgentSelect = document.getElementById('autonomous-review-agent');
  if (reviewAgentSelect) {
    reviewAgentSelect.addEventListener('change', () => updateReviewerTripletSelects(reviewAgentSelect.value));
  }
  modal.addEventListener('change', (e) => {
    if (e.target && e.target.closest('#autonomous-agent-checks')) {
      updateAutonomousModeControls();
    }
  });
});

// ── Agent budget widget (F322) ──────────────────────────────────────────────

const BUDGET_STALE_MS = 90 * 60 * 1000;
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
    .then(r => r.ok ? r.json() : { cc: null, cx: null })
    .catch(() => ({ cc: null, cx: null }))
    .then(data => { _budgetCache = data || { cc: null, cx: null }; _budgetFetchPromise = null; return _budgetCache; });
  return _budgetFetchPromise;
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

function buildBudgetMetric({ label, pctRemaining, resetsAt, polledAt }) {
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
  if (resetsAt) {
    wrap.appendChild(createEl('span', { className: 'budget-label', text: '↻ ' + resetsAt }));
  }
  return wrap;
}

function ccRemaining(entry) {
  if (!entry || entry.pct_used == null) return null;
  return 100 - entry.pct_used;
}

function renderBudgetWidget() {
  const el = document.getElementById('budget-widget');
  if (!el) return;
  const data = _budgetCache || { cc: null, cx: null };
  const cc = data.cc;
  const cx = data.cx;
  if (!cc && !cx) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const children = [];

  if (cc) {
    const sessionPct = ccRemaining(cc.session);
    const weekPct = ccRemaining(cc.week_all);
    const sonnetPct = ccRemaining(cc.week_sonnet);
    const row = createEl('span', { className: 'budget-agent' });
    row.appendChild(createEl('span', { className: 'budget-agent-name', text: 'Claude Code' }));
    row.appendChild(buildBudgetMetric({
      label: 'session',
      pctRemaining: sessionPct,
      resetsAt: cc.session && cc.session.resets_at,
      polledAt: cc.polled_at,
    }));
    row.appendChild(buildBudgetMetric({
      label: 'week',
      pctRemaining: weekPct,
      resetsAt: cc.week_all && cc.week_all.resets_at,
      polledAt: cc.polled_at,
    }));
    if (cc.week_sonnet) {
      row.appendChild(buildBudgetMetric({
        label: 'sonnet',
        pctRemaining: sonnetPct,
        resetsAt: cc.week_sonnet.resets_at,
        polledAt: cc.polled_at,
      }));
    }
    children.push(row);
  }
  if (cx) {
    const fivePct = cx.five_hour ? cx.five_hour.pct_remaining : null;
    const weeklyPct = cx.weekly ? cx.weekly.pct_remaining : null;
    const row = createEl('span', { className: 'budget-agent' });
    row.appendChild(createEl('span', { className: 'budget-agent-name', text: 'Codex' }));
    row.appendChild(buildBudgetMetric({
      label: '5h',
      pctRemaining: fivePct,
      resetsAt: cx.five_hour && cx.five_hour.resets_at,
      polledAt: cx.polled_at,
    }));
    row.appendChild(buildBudgetMetric({
      label: 'week',
      pctRemaining: weeklyPct,
      resetsAt: cx.weekly && cx.weekly.resets_at,
      polledAt: cx.polled_at,
    }));
    children.push(row);
  }

  const meta = createEl('span', { className: 'budget-meta' });
  const latest = [cc && cc.polled_at, cx && cx.polled_at].filter(Boolean).sort().pop();
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
  const data = _budgetCache;
  if (!data) return;
  const picker = document.getElementById('agent-picker');
  if (!picker || picker.style.display === 'none') return;
  const rows = picker.querySelectorAll('.agent-check-row');
  rows.forEach(row => {
    const cb = row.querySelector('input');
    if (!cb) return;
    const id = cb.value;
    if (id !== 'cc' && id !== 'cx') return;
    const existing = row.querySelector('.agent-check-budget');
    if (existing) existing.remove();

    const entry = data[id];
    if (!entry) return;
    let worstPct = null;
    let summary = '';
    if (id === 'cc') {
      const s = ccRemaining(entry.session);
      const w = ccRemaining(entry.week_all);
      if (s == null && w == null) return;
      worstPct = [s, w].filter(v => v != null).reduce((a, b) => Math.min(a, b), 100);
      summary = `${s != null ? s + '% session' : 'session —'} · ${w != null ? w + '% week' : 'week —'}`;
    } else {
      const fh = entry.five_hour && entry.five_hour.pct_remaining;
      const wk = entry.weekly && entry.weekly.pct_remaining;
      if (fh == null && wk == null) return;
      worstPct = [fh, wk].filter(v => v != null).reduce((a, b) => Math.min(a, b), 100);
      summary = `${fh != null ? fh + '% 5h' : '5h —'} · ${wk != null ? wk + '% week' : 'week —'}`;
    }
    const klass = budgetClassFor(worstPct, entry.polled_at);
    const el = createEl('span', { className: 'agent-check-budget ' + klass, text: summary + (worstPct != null && worstPct < 20 ? ' ⚠' : '') });
    row.appendChild(el);
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
      if (s != null && s < 20) { worst = s; label = 'session'; }
      if (w != null && w < 20 && (worst == null || w < worst)) { worst = w; label = 'weekly'; }
    } else if (id === 'cx') {
      const fh = entry.five_hour && entry.five_hour.pct_remaining;
      const wk = entry.weekly && entry.weekly.pct_remaining;
      if (fh != null && fh < 20) { worst = fh; label = '5-hour'; }
      if (wk != null && wk < 20 && (worst == null || wk < worst)) { worst = wk; label = 'weekly'; }
    }
    if (worst != null) {
      const name = id === 'cc' ? 'Claude Code' : 'Codex';
      warnings.push(`${name} is at ${100 - worst}% of its ${label} limit (${worst}% remaining).`);
    }
  }
  return warnings.length > 0 ? warnings.join('\n') + '\n\nStart anyway?' : null;
}

document.addEventListener('DOMContentLoaded', () => {
  fetchBudget().then(renderBudgetWidget);
  // Refresh widget every 2 minutes to keep "updated Xmin ago" accurate and pick up fresh polls.
  setInterval(() => { fetchBudget(true).then(renderBudgetWidget); }, 2 * 60 * 1000);

  // Annotate agent picker rows whenever it is opened.
  const picker = document.getElementById('agent-picker');
  if (picker) {
    const observer = new MutationObserver(() => {
      if (picker.style.display === 'flex') {
        fetchBudget().then(annotateAgentPickerBudget);
      }
    });
    observer.observe(picker, { attributes: true, attributeFilter: ['style'] });
  }
});
