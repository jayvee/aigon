/* dashboard-esm-processed */
import { agents, defaultAgent } from './injected.js';
import { fetchAgentModels } from './agent-models.js';
import { benchTooltip, quotaEntryForModel, quotaTooltip } from './budget-widget.js';
// F519: triplet picker + shared DOM helpers
// ── Unified action renderer + dispatcher ────────────────────────────────────
// Single source of truth for feature/research/feedback action buttons.
// Both Monitor and Pipeline views call these functions instead of maintaining
// their own rendering logic.

/* dashboard-esm-processed */

const AIGON_AGENTS = agents;
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

/** Agents eligible for dashboard pickers (Start, review, eval). Skips unconfigured/disabled. */
function getPickerEligibleAgents(options = {}) {
  const autonomousOnly = !!options.autonomousOnly;
  return AIGON_AGENTS.filter(agent => {
    if (!agent || !agent.id) return false;
    if (agent.pickerEligible === false) return false;
    if (autonomousOnly && agent.autonomousEligible === false) return false;
    return true;
  });
}

function getAutonomousAgentIds() {
  return getPickerEligibleAgents({ autonomousOnly: true }).map(agent => agent.id);
}
const AUTONOMOUS_AGENT_IDS = getAutonomousAgentIds();

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
// Shape: { complexity, agents: { <id>: { model, effort, modelSource, effortSource } }, _ranked?: [] }
// Pre-selects dropdowns; user can still override.
let pickerRecommendation = null;
function setPickerRecommendation(rec) {
  pickerRecommendation = rec || null;
}

function getRecommendedValue(agentId, field) {
  if (!pickerRecommendation || !pickerRecommendation.agents) return null;
  const entry = pickerRecommendation.agents[agentId];
  if (!entry) return null;
  return entry[field] == null ? null : String(entry[field]);
}

function findModelOption(agent, value) {
  const opts = agent && Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  const v = value == null ? '' : String(value);
  return opts.find(o => String(o.value || '') === v) || null;
}

function buildModelOptionDisplayLabel(opt) {
  const raw = opt.label || (opt.value == null ? '' : String(opt.value));
  return opt.value == null && (!raw || raw === 'Use config default') ? 'Default' : (raw || String(opt.value));
}

/** Human-readable configured-model cell text; full id/path in title. */
function formatConfiguredModelDisplay(agentOrId, rawValue) {
  const raw = rawValue == null ? '' : String(rawValue).trim();
  if (!raw) return { label: '—', title: 'No model configured for this task type' };
  const agent = typeof agentOrId === 'object' && agentOrId
    ? agentOrId
    : AIGON_AGENTS.find((a) => a.id === agentOrId);
  const opt = agent ? findModelOption(agent, raw) : null;
  if (opt && opt.label) return { label: buildModelOptionDisplayLabel(opt), title: raw };
  const shortened = raw
    .replace(/^openrouter\//, '')
    .replace(/^ollama\//, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join(' / ') || raw;
  return { label: shortened, title: raw };
}

function applyConfiguredModelCell(el, agentOrId, rawValue) {
  if (!el) return;
  const { label, title } = formatConfiguredModelDisplay(agentOrId, rawValue);
  el.textContent = label;
  if (title && title !== label) el.setAttribute('title', title);
  else el.removeAttribute('title');
}

function decorateModelSelectOption(el, opt, agent) {
  el.value = opt.value == null ? '' : String(opt.value);
  let label = buildModelOptionDisplayLabel(opt);
  const quotaEntry = typeof quotaEntryForModel === 'function' ? quotaEntryForModel(agent.id, opt.value) : null;
  const headline = opt.summary && opt.summary.headline ? String(opt.summary.headline) : '';
  if (quotaEntry && quotaEntry.verdict === 'depleted') {
    el.disabled = true;
    label = '🔒 ' + label;
    el.title = typeof quotaTooltip === 'function' ? quotaTooltip(quotaEntry) : '';
  } else {
    const benchTip = typeof benchTooltip === 'function' ? benchTooltip(quotaEntry) : '';
    if (benchTip) {
      label = '⚠ ' + label;
      el.title = benchTip;
    } else if (headline) {
      el.title = headline;
    }
  }
  el.textContent = label;
}

function syncModelSummaryHint(selectEl, agent, pickerRole) {
  const opt = findModelOption(agent, selectEl.value);
  const headline = opt && opt.summary && opt.summary.headline ? String(opt.summary.headline) : '';
  if (!headline) return;
  const summary = opt.summary;
  const shouldWarn = pickerRole === 'review'
    && Array.isArray(summary.avoidFor)
    && summary.avoidFor.includes('review');
  const summaryNote = shouldWarn
    ? `Not recommended for code review. ${headline}`
    : headline;
  const base = String(selectEl.title || '').trim();
  if (base.includes(headline)) return;
  selectEl.title = base ? `${base} — ${summaryNote}` : summaryNote;
}

function wireModelSummarySelect(sel, agent, pickerRole) {
  const update = () => syncModelSummaryHint(sel, agent, pickerRole);
  sel.addEventListener('change', update);
  update();
}

function applyRecommendedTripletToSelects(agent, modelSel, effortSel, pickerRole) {
  if (!agent) return;
  const modelOpts = Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  const effortOpts = Array.isArray(agent.effortOptions) ? agent.effortOptions : [];
  if (modelSel && modelOpts.length > 0) {
    const recommended = getRecommendedValue(agent.id, 'model');
    if (recommended && modelOpts.some((o) => String(o.value || '') === recommended)) {
      modelSel.value = recommended;
      modelSel.classList.add('agent-triplet-recommended');
      syncModelSummaryHint(modelSel, agent, pickerRole);
    }
  }
  if (effortSel && effortOpts.length > 0) {
    const recommendedEffort = getRecommendedValue(agent.id, 'effort');
    if (recommendedEffort && effortOpts.some((o) => String(o.value || '') === recommendedEffort)) {
      effortSel.value = recommendedEffort;
      effortSel.classList.add('agent-triplet-recommended');
    }
  }
}

/** Re-apply spec recommendations after async /api/recommendation resolves (autonomous modal). */
function refreshAutonomousPickerTriplets() {
  document.querySelectorAll('#autonomous-agent-checks .agent-check-row[data-agent-id]').forEach((row) => {
    const agent = AIGON_AGENTS.find((a) => a.id === row.dataset.agentId);
    if (!agent) return;
    applyRecommendedTripletToSelects(
      agent,
      row.querySelector('.agent-triplet-model'),
      row.querySelector('.agent-triplet-effort'),
      null,
    );
  });
  const reviewSel = document.getElementById('autonomous-review-agent');
  if (reviewSel && !reviewSel.disabled) {
    updateReviewerTripletSelects(String(reviewSel.value || '').trim(), 'autonomous');
  }
}

// Append model + effort controls for triplet-grid rows. Always emits two
// columns (select or placeholder) so the agent-picker grid stays aligned.
function appendTripletSelects(rowEl, agent, options) {
  const opts = options || {};
  const pickerRole = opts.pickerRole == null ? null : opts.pickerRole;
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
      decorateModelSelectOption(el, opt, agent);
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
    const selectedQuota = typeof quotaEntryForModel === 'function' ? quotaEntryForModel(agent.id, sel.value || null) : null;
    if (selectedQuota && selectedQuota.verdict === 'depleted') sel.title = typeof quotaTooltip === 'function' ? quotaTooltip(selectedQuota) : '';
    else {
      const selectedBenchTip = typeof benchTooltip === 'function' ? benchTooltip(selectedQuota) : '';
      if (selectedBenchTip) sel.title = selectedBenchTip;
    }
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      e.stopPropagation();
      sel.classList.remove('agent-triplet-recommended');
      tripletStorage.write(agent.id, { model: sel.value || null });
    });
    cellModel.appendChild(sel);
    wireModelSummarySelect(sel, agent, pickerRole);
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
  const prefix = scope === 'picker-set'
    ? 'agent-picker-review'
    : (scope === 'schedule-kickoff' ? 'schedule-kickoff-review' : 'autonomous-review');
  const pickerRole = 'review';
  const modelCell = document.getElementById(prefix + '-model-cell');
  const effortCell = document.getElementById(prefix + '-effort-cell');
  if (!modelCell || !effortCell) return;
  const agent = agentId ? AIGON_AGENTS.find(a => a.id === agentId) : null;
  const modelOpts = agent && Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  const effortOpts = agent && Array.isArray(agent.effortOptions) ? agent.effortOptions : [];

  modelCell.innerHTML = '';
  if (modelOpts.length > 0 && agent) {
    const sel = document.createElement('select');
    sel.id = prefix + '-model';
    sel.className = 'agent-triplet-model create-input';
    sel.style.cssText = 'padding:8px 10px;width:100%';
    sel.dataset.agentId = agent.id;
    modelOpts.forEach(opt => {
      const el = document.createElement('option');
      decorateModelSelectOption(el, opt, agent);
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
    modelCell.appendChild(sel);
    wireModelSummarySelect(sel, agent, pickerRole);
  } else {
    modelCell.appendChild(appendTripletPlaceholder('No per-run model override for this agent'));
  }

  effortCell.innerHTML = '';
  if (effortOpts.length > 0 && agent) {
    const sel = document.createElement('select');
    sel.id = prefix + '-effort';
    sel.className = 'agent-triplet-effort create-input';
    sel.style.cssText = 'padding:8px 10px;width:100%';
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
  if (!recommendation || (!recommendation.complexity && !recommendation.specAuthorPreselect && (!recommendation.agents || Object.values(recommendation.agents).every(a => !a.model && !a.effort)))) {
    banner.setAttribute('data-hidden', '');
    banner.innerHTML = '';
    return;
  }
  banner.removeAttribute('data-hidden');
  const agentBits = [];
  Object.entries(recommendation.agents || {}).forEach(([id, entry]) => {
    if (!entry || (!entry.model && !entry.effort)) return;
    const modelLabel = entry.model || 'default';
    const effortLabel = entry.effort ? '/' + entry.effort : '';
    agentBits.push('<span class="recommendation-agent"><b>' + id + '</b> ' + modelLabel + effortLabel + '</span>');
  });
  let html = '';
  if (recommendation.specAuthorPreselect) {
    html += '<p class="recommendation-explainer">Pre-selected from <strong>original spec authorship</strong>.</p>';
  }
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
// Returns the `resolved` payload (with per-agent fallback chain applied)
// merged with `ranked` from the agent matrix, or null.
async function fetchSpecRecommendation(type, id, repoPath) {
  try {
    const url = '/api/recommendation/' + encodeURIComponent(type) + '/' + encodeURIComponent(id)
      + (repoPath ? '?repoPath=' + encodeURIComponent(repoPath) : '');
    const res = await fetch(url, { headers: { 'accept': 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || !body.resolved) return null;
    // Attach ranked list onto resolved so callers can pass it through as one object
    const result = Object.assign({}, body.resolved);
    if (Array.isArray(body.ranked) && body.ranked.length > 0) result._ranked = body.ranked;
    return result;
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
    if (option.role) el.dataset.role = option.role;
    return el;
  });
  replaceNodeChildren(select, opts);
}

// Maps action + priority to button CSS class
function validActionBtnClass(action, priority) {
  if (priority === 'high') return 'btn btn-primary';
  if (action === 'feature-stop' || action === 'research-stop' || action === 'feature-reset' || action === 'research-reset'
    || action === 'set-autonomous-stop' || action === 'set-autonomous-reset'
    || action === 'feature-cancel-code-review' || action === 'research-cancel-code-review') return 'btn btn-danger';
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

function renderAgentPickerRows(options) {
  const opts = options || {};
  const collectTriplet = !!opts.collectTriplet;
  const pickerRole = opts.pickerRole == null ? null : opts.pickerRole;
  const checks = document.getElementById('agent-picker-checks');
  if (!checks) return;
  const rows = getPickerEligibleAgents().map(agent => {
    const row = buildAgentCheckRow({
      value: agent.id,
      label: agent.id,
      hint: agent.displayName || agent.id,
      tripletGrid: collectTriplet,
      tripletCheckboxIdPrefix: collectTriplet ? 'agent-picker' : undefined,
    });
    if (collectTriplet) {
      row.dataset.agentId = agent.id;
      appendTripletSelects(row, agent, { pickerRole });
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

let autonomousModalModels = null;

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
  return fetchAgentModels(repoPath).then(setup).catch(function() { setup({}); });
}
export { populateSetAgentPickerReviewerSection };

document.addEventListener('DOMContentLoaded', () => {
  renderAgentPickerRows();
});

// ── ESM exports (F623) ──
export {
  AGENT_DISPLAY_NAMES,
  AGENT_SHORT_NAMES,
  AIGON_AGENTS,
  appendTripletSelects,
  applyConfiguredModelCell,
  AUTONOMOUS_AGENT_IDS,
  buildAgentCheckRow,
  buildTripletPickerHeaderRow,
  complexityBadgeHtml,
  createEl,
  fetchSpecRecommendation,
  formatConfiguredModelDisplay,
  getAutonomousAgentIds,
  getPickerEligibleAgents,
  refreshAutonomousPickerTriplets,
  renderAgentPickerRows,
  renderPickerRecommendationBanner,
  replaceNodeChildren,
  replaceSelectOptions,
  setPickerRecommendation,
  showConfirm,
  showDangerConfirm,
  tripletsToCliArgs,
  updateReviewerTripletSelects,
};
