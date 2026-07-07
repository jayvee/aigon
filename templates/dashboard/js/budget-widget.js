// F519: agent budget + quota widget (extracted from actions.js)
// ── Agent budget widget (F322; extended for op + cu coverage in F457) ──────

const BUDGET_STALE_MS = 90 * 60 * 1000;
const BUDGET_WIDGET_HIDDEN_KEY = 'aigon:budget-widget-hidden';
const BUDGET_WIDGET_COLLAPSED_KEY = 'aigon:budget-widget-collapsed';
let _budgetCache = null;
let _budgetFetchPromise = null;
let _quotaCache = null;
let _quotaFetchPromise = null;

function fetchQuota(force) {
  if (_quotaFetchPromise && !force) return _quotaFetchPromise;
  _quotaFetchPromise = fetch('/api/quota', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : { agents: {}, providers: {} })
    .catch(() => ({ agents: {}, providers: {} }))
    .then(data => {
      _quotaCache = data || { agents: {}, providers: {} };
      if (!_quotaCache.providers) _quotaCache.providers = {};
      _quotaFetchPromise = null;
      return _quotaCache;
    });
  return _quotaFetchPromise;
}

function linkedProviderIds(agentId) {
  const agent = AIGON_AGENTS.find(a => a.id === agentId);
  return agent && Array.isArray(agent.quotaProviders) ? agent.quotaProviders : [];
}

function providerEntry(providerId) {
  return _quotaCache && _quotaCache.providers && _quotaCache.providers[providerId]
    ? _quotaCache.providers[providerId]
    : null;
}

function formatUsd(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return '$' + value.toFixed(2);
}

function providerHeadline(entry) {
  if (!entry) return null;
  if (entry.walletUsd != null) return `${entry.displayName || 'Provider'} · ${formatUsd(entry.balanceUsd)} remaining`;
  if (entry.keyLimitUsd != null && entry.keyLimitRemainingUsd != null) {
    const reset = entry.keyLimitReset ? ` ${entry.keyLimitReset}` : '';
    return `${entry.displayName || 'Provider'} · limit ${formatUsd(entry.keyLimitRemainingUsd)} / ${formatUsd(entry.keyLimitUsd)}${reset}`;
  }
  if (entry.balanceUsd != null) return `${entry.displayName || 'Provider'} · ${formatUsd(entry.balanceUsd)} remaining`;
  return `${entry.displayName || 'Provider'} · balance unknown`;
}

function providerSpendLine(entry) {
  if (!entry) return null;
  const parts = [];
  if (entry.usageDailyUsd != null) parts.push(`${formatUsd(entry.usageDailyUsd)} today`);
  if (entry.usageWeeklyUsd != null) parts.push(`${formatUsd(entry.usageWeeklyUsd)} this week`);
  return parts.length ? parts.join(' · ') : null;
}

function worstProviderVerdict(agentId) {
  const ids = linkedProviderIds(agentId);
  const severity = { depleted: 4, low: 3, error: 2, unknown: 1, available: 0 };
  let worst = null;
  let worstScore = -1;
  for (const id of ids) {
    const entry = providerEntry(id);
    if (!entry || !entry.verdict) continue;
    const score = severity[entry.verdict] || 0;
    if (score > worstScore) {
      worstScore = score;
      worst = entry;
    }
  }
  return worst;
}

function quotaEntryForModel(agentId, modelValue) {
  const agent = _quotaCache && _quotaCache.agents && _quotaCache.agents[agentId];
  const models = agent && agent.models;
  if (!models) return null;
  return models[modelValue || '__default__'] || null;
}

function quotaTooltip(entry) {
  if (!entry || entry.verdict !== 'depleted') return '';
  const reset = entry.resetAt ? new Date(entry.resetAt) : null;
  const resetLabel = reset && !Number.isNaN(reset.getTime())
    ? ('resets at ' + reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    : 'Reset time unknown';
  const probed = entry.lastProbedAt ? (' Last probed ' + fmtRelAgo(entry.lastProbedAt) + '.') : '';
  return 'Out of quota — ' + resetLabel + '.' + probed;
}

// F456: probe alone is necessary but not sufficient — a model can pass the
// single-turn API probe and still time out on a multi-turn agent loop. Yellow
// signals "API responds but never bench-validated (or last bench failed)".
function benchTooltip(entry) {
  if (!entry || entry.verdict === 'depleted' || !entry.probeOk) return '';
  if (entry.benchVerdict === 'passed') return '';
  if (entry.benchVerdict === 'failed' && entry.lastBenchAt) {
    return 'Bench failed ' + fmtRelAgo(entry.lastBenchAt) + ' — may time out on real agent work.';
  }
  if (entry.benchVerdict === 'failed') return 'Bench failed — may time out on real agent work.';
  return 'Never bench-tested — single-turn probe ok, but multi-turn run not verified.';
}

// Pair signal: green = probe ok + bench passed; yellow = probe ok + bench
// missing/failed; red handled by existing depleted/probe-fail logic.
function pairSignalClass(entry) {
  if (!entry) return 'budget-stale';
  if (entry.verdict === 'depleted') return 'budget-red';
  if (!entry.probeOk) return 'budget-red';
  if (entry.benchVerdict === 'passed') return 'budget-green';
  return 'budget-yellow';
}

function budgetClassFor(pctRemaining, polledAt) {
  if (polledAt && Date.now() - new Date(polledAt).getTime() > BUDGET_STALE_MS) return 'budget-stale';
  if (pctRemaining == null || Number.isNaN(pctRemaining)) return 'budget-stale';
  if (pctRemaining < 20) return 'budget-red';
  if (pctRemaining < 50) return 'budget-amber';
  return 'budget-green';
}

// F444 verdict → existing budget-status-dot colour class.
function quotaVerdictClass(verdict) {
  if (verdict === 'depleted') return 'budget-red';
  if (verdict === 'low') return 'budget-amber';
  if (verdict === 'unknown') return 'budget-yellow';
  if (verdict === 'error') return 'budget-amber';
  if (verdict === 'available') return 'budget-green';
  return 'budget-stale'; // not-probeable / no data
}

// Roll an agent's per-model F444 verdicts into a single panel-level state.
function agentQuotaRollup(agentId) {
  const agent = _quotaCache && _quotaCache.agents && _quotaCache.agents[agentId];
  if (!agent || !agent.models) return { verdict: null, total: 0, depleted: 0, available: 0, unknown: 0, error: 0, probeable: false };
  const models = Object.values(agent.models).filter(m => !(m && m.probeMethod === 'not-probeable'));
  const probeable = models.length > 0;
  const total = probeable ? models.length : Object.values(agent.models).length;
  let depleted = 0, available = 0, unknown = 0, error = 0;
  for (const m of models) {
    if (m.verdict === 'depleted') depleted++;
    else if (m.verdict === 'available') available++;
    else if (m.verdict === 'error') error++;
    else unknown++;
  }
  let verdict;
  if (!probeable) verdict = 'not-probeable';
  else if (depleted > 0 && available === 0) verdict = 'depleted';
  else if (depleted > 0) verdict = 'mixed';
  else if (error > 0 && available === 0) verdict = 'error';
  else if (unknown > 0 && available === 0) verdict = 'unknown';
  else verdict = 'available';

  const provider = worstProviderVerdict(agentId);
  if (provider) {
    if (provider.verdict === 'depleted') verdict = 'depleted';
    else if (provider.verdict === 'low' && verdict !== 'depleted') verdict = 'mixed';
    else if (provider.verdict === 'error' && verdict === 'available') verdict = 'error';
    else if (provider.verdict === 'unknown' && verdict === 'available' && !probeable) verdict = 'unknown';
  }
  return { verdict, total, depleted, available, unknown, error, probeable, provider };
}

function quotaRollupClass(rollup) {
  if (!rollup || rollup.verdict === 'not-probeable') {
    if (rollup && rollup.provider && rollup.provider.verdict) return quotaVerdictClass(rollup.provider.verdict);
    return 'budget-stale';
  }
  if (rollup.verdict === 'depleted') return 'budget-red';
  if (rollup.verdict === 'mixed') return 'budget-amber';
  if (rollup.verdict === 'error') return 'budget-amber';
  if (rollup.verdict === 'unknown') return 'budget-yellow';
  if (rollup.provider && (rollup.provider.verdict === 'low' || rollup.provider.verdict === 'depleted')) {
    return quotaVerdictClass(rollup.provider.verdict);
  }
  return 'budget-green';
}

// Pick the most-explanatory error string from the depleted models for display.
function quotaReasonText(agentId) {
  const agent = _quotaCache && _quotaCache.agents && _quotaCache.agents[agentId];
  if (!agent || !agent.models) return null;
  const depleted = Object.values(agent.models).find(m => m && m.verdict === 'depleted' && m.lastProbeOutput);
  if (depleted && depleted.lastProbeOutput) {
    const text = String(depleted.lastProbeOutput).split('\n')[0].slice(0, 90);
    if (depleted.resetAt) {
      const reset = new Date(depleted.resetAt);
      if (!Number.isNaN(reset.getTime())) {
        return text + ' · resets ' + reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
    return text + (depleted.resetAt ? '' : ' · reset unknown');
  }
  const unknown = Object.values(agent.models).find(m => m && m.verdict === 'unknown');
  if (unknown) return 'classifier did not match probe output';
  return null;
}

function fetchBudget(force) {
  if (_budgetFetchPromise && !force) return _budgetFetchPromise;
  _budgetFetchPromise = fetch('/api/budget', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : { cc: null, cx: null, gg: null, km: null, ag: null })
    .catch(() => ({ cc: null, cx: null, gg: null, km: null, ag: null }))
    .then(data => { _budgetCache = data || { cc: null, cx: null, gg: null, km: null, ag: null }; _budgetFetchPromise = null; return _budgetCache; });
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
  const agent = AIGON_AGENTS.find(a => a.id === agentId);
  if (!agent) return false;
  const state = agent.availability && agent.availability.state;
  if (state === 'disabled' || state === 'retired') return false;
  return true;
}

function hasAnyBudgetData(data) {
  const entry = data || _budgetCache || {};
  if (entry.cc || entry.cx || entry.gg || entry.km || entry.ag) return true;
  // Show panel even when only F444 quota data exists (e.g. op/ag only).
  const quotaAgents = _quotaCache && _quotaCache.agents;
  if (quotaAgents) {
    for (const id of ['cc', 'cx', 'gg', 'km', 'op', 'ag']) {
      if (!budgetAgentEnabled(id)) continue;
      if (quotaAgents[id] && quotaAgents[id].models && Object.keys(quotaAgents[id].models).length > 0) return true;
    }
  }
  const providers = _quotaCache && _quotaCache.providers;
  if (providers && Object.keys(providers).length > 0) return true;
  return false;
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
  if (budgetAgentEnabled('km') && data.km && Array.isArray(data.km.tiers)) {
    touchPoll(data.km.polled_at);
    for (const t of data.km.tiers) {
      if (t && t.pct_used != null) {
        const rem = 100 - t.pct_used;
        if (Number.isFinite(rem)) values.push(rem);
      }
    }
  }
  if (budgetAgentEnabled('ag') && data.ag && Array.isArray(data.ag.tiers)) {
    touchPoll(data.ag.polled_at);
    for (const t of data.ag.tiers) {
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
  // Worst class across F445 numeric bars …
  let cls = values.length === 0 ? 'budget-stale' : budgetClassFor(values.reduce((a, b) => Math.min(a, b), 100), polledAt);
  // … and F444 verdicts (so op-depleted alone turns the panel red even when cc/cx are healthy).
  const severity = { 'budget-red': 4, 'budget-amber': 3, 'budget-yellow': 2, 'budget-stale': 1, 'budget-green': 0 };
  for (const id of ['cc', 'cx', 'gg', 'km', 'op', 'ag']) {
    if (!budgetAgentEnabled(id)) continue;
    const rollup = agentQuotaRollup(id);
    if (!rollup.probeable && !rollup.provider) continue;
    const rcls = quotaRollupClass(rollup);
    if ((severity[rcls] || 0) > (severity[cls] || 0)) cls = rcls;
  }
  return cls;
}

function budgetOverallAriaLabel(summaryClass) {
  if (summaryClass === 'budget-red') return 'Overall quota headroom: low';
  if (summaryClass === 'budget-amber') return 'Overall quota headroom: moderate';
  if (summaryClass === 'budget-green') return 'Overall quota headroom: healthy';
  return 'Overall quota: stale or unavailable';
}

function budgetCollapsedSummaryLine(data) {
  const parts = [];
  for (const id of ['cc', 'cx', 'gg', 'km', 'ag']) {
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

// Per-agent dot strip for the collapsed view: one tiny coloured dot + agent
// code per agent so the user can scan probeable agents without expanding.
function buildCollapsedDotsRow(data) {
  const wrap = createEl('div', { className: 'budget-collapsed-dots', attrs: { 'aria-label': 'Per-agent quota state' } });
  const agentMeta = [
    ['cc', 'cc'], ['cx', 'cx'], ['gg', 'gg'], ['km', 'km'], ['op', 'op'], ['ag', 'ag'],
  ];
  for (const [id, code] of agentMeta) {
    if (!budgetAgentEnabled(id)) continue;
    // Prefer F444 verdict if present; else fall back to F445-style worst-of-bars.
    const rollup = agentQuotaRollup(id);
    let cls;
    let title;
    if (rollup && rollup.verdict) {
      cls = quotaRollupClass(rollup);
      if (rollup.verdict === 'depleted') title = `${id}: out of quota (${rollup.depleted}/${rollup.total} models)`;
      else if (rollup.verdict === 'mixed') title = `${id}: mixed (${rollup.depleted}/${rollup.total} depleted)`;
      else if (rollup.verdict === 'unknown') title = `${id}: probe output didn't match any pattern`;
      else if (rollup.verdict === 'not-probeable') title = `${id}: no headless CLI`;
      else if (rollup.verdict === 'error') title = `${id}: probe error`;
      else title = `${id}: available (${rollup.available}/${rollup.total} models)`;
      if (rollup.provider && rollup.provider.verdict === 'depleted') {
        cls = 'budget-red';
        title = `${id}: provider balance depleted`;
      } else if (rollup.provider && rollup.provider.verdict === 'low') {
        if (cls === 'budget-green') cls = 'budget-amber';
        title += ` · provider low (${formatUsd(rollup.provider.balanceUsd)})`;
      }
    } else if (data && data[id]) {
      // Has F445 budget bars but no F444 verdict — derive class from bars.
      const sub = collectBudgetPctValues({ [id]: data[id] });
      const worst = sub.values.length ? sub.values.reduce((a, b) => Math.min(a, b), 100) : null;
      cls = worst != null ? budgetClassFor(worst, sub.polledAt) : 'budget-stale';
      title = `${id}: ${cls === 'budget-green' ? 'available' : cls === 'budget-amber' ? 'low headroom' : cls === 'budget-red' ? 'critical' : 'stale'}`;
    } else {
      cls = 'budget-stale';
      title = `${id}: no data`;
    }
    const dotWrap = createEl('span', { className: 'budget-collapsed-dot', attrs: { title } });
    dotWrap.appendChild(createEl('span', { className: 'budget-status-dot ' + cls, attrs: { role: 'img', 'aria-label': title } }));
    dotWrap.appendChild(createEl('span', { className: 'budget-collapsed-dot-code', text: code }));
    wrap.appendChild(dotWrap);
  }
  return wrap;
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
  const name = agentId === 'cc' ? 'Claude Code'
    : agentId === 'cx' ? 'Codex'
    : agentId === 'km' ? 'Kimi'
    : agentId === 'ag' ? 'Antigravity'
    : 'Gemini';
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
  if (agentId === 'gg' || agentId === 'km' || agentId === 'ag') {
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
        resetsDate: entry.week_all && entry.week_all.resets_date,
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
  const data = _budgetCache || { cc: null, cx: null, gg: null, km: null, ag: null };
  const cc = data.cc;
  const cx = data.cx;
  const gg = data.gg;
  const km = data.km;
  const ag = data.ag;
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

  const latest = [cc && cc.polled_at, cx && cx.polled_at, gg && gg.polled_at, km && km.polled_at, ag && ag.polled_at].filter(Boolean).sort().pop();
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
    children.push(buildCollapsedDotsRow(data));
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
        resetsDate: cc.week_all && cc.week_all.resets_date,
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
  if (budgetAgentEnabled('km')) {
    const row = createEl('span', { className: 'budget-agent' });
    const head = createEl('span', { className: 'budget-agent-head' });
    head.appendChild(createEl('span', { className: 'budget-agent-name', text: 'Kimi' }));
    row.appendChild(head);
    if (km && Array.isArray(km.tiers) && km.tiers.length) {
      for (const t of km.tiers) {
        const pctRem = t.pct_used != null ? 100 - t.pct_used : null;
        row.appendChild(buildBudgetMetric({
          label: (t.label || t.tier || 'tier') + ' remaining',
          pctRemaining: pctRem,
          resetsAt: t.resets_at || null,
          resetsDate: t.resets_date || null,
          resetsAtEpoch: t.resets_at_epoch || null,
          polledAt: km.polled_at,
        }));
      }
    } else {
      row.appendChild(createEl('span', { className: 'budget-unavailable', text: 'usage unavailable' }));
    }
    agentsWrap.appendChild(row);
  }
  if (budgetAgentEnabled('ag')) {
    const row = createEl('span', { className: 'budget-agent' });
    const head = createEl('span', { className: 'budget-agent-head' });
    head.appendChild(createEl('span', { className: 'budget-agent-name', text: 'Antigravity' }));
    row.appendChild(head);
    if (ag && Array.isArray(ag.tiers) && ag.tiers.length) {
      for (const t of ag.tiers) {
        const pctRem = t.pct_used != null ? 100 - t.pct_used : null;
        row.appendChild(buildBudgetMetric({
          label: (t.label || t.tier || 'tier') + ' weekly remaining',
          pctRemaining: pctRem,
          resetsAt: t.resets_at || null,
          polledAt: ag.polled_at,
        }));
      }
    } else {
      const rollup = agentQuotaRollup('ag');
      if (rollup.total > 0 || _quotaCache) {
        const support = rollup.probeable
          ? `${rollup.available} / ${rollup.total} available`
          : 'not probeable';
        head.appendChild(createEl('span', { className: 'budget-agent-support', text: support }));
        const reason = quotaReasonText('ag');
        if (reason) row.appendChild(createEl('span', { className: 'budget-agent-reason', text: reason }));
        else row.appendChild(createEl('span', { className: 'budget-unavailable', text: 'usage unavailable' }));
      } else {
        row.appendChild(createEl('span', { className: 'budget-unavailable', text: 'usage unavailable' }));
      }
    }
    agentsWrap.appendChild(row);
  }
  if (budgetAgentEnabled('op')) {
    const rollup = agentQuotaRollup('op');
    if (rollup.total > 0 || _quotaCache) {
      const row = createEl('span', { className: 'budget-agent' });
      const head = createEl('span', { className: 'budget-agent-head' });
      head.appendChild(createEl('span', { className: 'budget-agent-name', text: 'OpenCode' }));
      const support = rollup.probeable
        ? `${rollup.available} / ${rollup.total} available`
        : 'not probeable';
      head.appendChild(createEl('span', { className: 'budget-agent-support', text: support }));
      row.appendChild(head);
      const reason = quotaReasonText('op');
      if (reason) row.appendChild(createEl('span', { className: 'budget-agent-reason', text: reason }));
      else if (!rollup.probeable) row.appendChild(createEl('span', { className: 'budget-unavailable', text: 'no headless CLI' }));

      const provider = rollup.provider || worstProviderVerdict('op');
      if (provider) {
        const providerRow = createEl('span', { className: 'budget-provider-subrow' });
        const providerHead = createEl('span', { className: 'budget-provider-head' });
        providerHead.appendChild(createEl('span', {
          className: 'budget-status-dot ' + quotaVerdictClass(provider.verdict),
          attrs: { role: 'img', 'aria-label': `${provider.displayName || 'Provider'} ${provider.verdict}` },
        }));
        providerHead.appendChild(createEl('span', { className: 'budget-provider-line', text: providerHeadline(provider) }));
        providerRow.appendChild(providerHead);
        const spend = providerSpendLine(provider);
        if (spend) providerRow.appendChild(createEl('span', { className: 'budget-provider-spend', text: spend }));
        row.appendChild(providerRow);
      }
      agentsWrap.appendChild(row);
    }
  }

  if (agentsWrap.childNodes.length) children.push(agentsWrap);

  const meta = createEl('span', { className: 'budget-meta' });
  if (latest) meta.appendChild(createEl('span', { text: 'updated ' + fmtRelAgo(latest) }));
  const refreshBtn = createEl('button', { className: 'budget-refresh', text: '↻', attrs: { title: 'Refresh budgets', 'aria-label': 'Refresh budgets' } });
  refreshBtn.onclick = () => {
    refreshBtn.classList.add('spinning');
    fetch('/api/budget/refresh', { method: 'POST' }).catch(() => {});
    fetch('/api/quota/refresh', { method: 'POST' }).catch(() => {});
    setTimeout(() => {
      Promise.all([fetchBudget(true), fetchQuota(true)]).then(renderBudgetWidget).finally(() => refreshBtn.classList.remove('spinning'));
    }, 10000);
  };
  meta.appendChild(refreshBtn);
  children.push(meta);

  replaceNodeChildren(el, children);
}

function annotateAgentPickerBudget() {
  const data = _budgetCache || { cc: null, cx: null, gg: null, km: null };
  const picker = document.getElementById('agent-picker');
  if (!picker || picker.style.display === 'none') return;
  const rows = picker.querySelectorAll('.agent-check-row');
  rows.forEach(row => {
    const cb = row.querySelector('input');
    if (!cb) return;
    const id = cb.value;
    if (id !== 'cc' && id !== 'cx' && id !== 'gg' && id !== 'km') return;
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
  const data = _budgetCache || { cc: null, cx: null, gg: null, km: null };
  const modal = document.getElementById('autonomous-modal');
  if (!modal || modal.style.display === 'none') return;
  const rows = modal.querySelectorAll('#autonomous-agent-checks .agent-check-row');
  rows.forEach(row => {
    const cb = row.querySelector('input');
    if (!cb) return;
    const id = cb.value;
    if (id !== 'cc' && id !== 'cx' && id !== 'gg' && id !== 'km') return;
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
    } else if ((id === 'gg' || id === 'km' || id === 'ag') && Array.isArray(entry.tiers)) {
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
      const name = id === 'cc' ? 'Claude Code' : id === 'cx' ? 'Codex' : id === 'km' ? 'Kimi' : id === 'ag' ? 'Antigravity' : 'Gemini';
      warnings.push(`${name} has only ${worst}% remaining in its ${label}.`);
    }
  }
  return warnings.length > 0 ? warnings.join('\n') + '\n\nStart anyway?' : null;
}

document.addEventListener('DOMContentLoaded', () => {
  fetchBudget().then(renderBudgetWidget);
  // Re-render the widget once F444 quota data lands so op/cu cards + the
  // collapsed-state dot strip light up without waiting for the 2-min interval.
  fetchQuota().then(() => renderBudgetWidget()).catch(() => {});
  // Refresh widget every 2 minutes to keep "updated Xmin ago" accurate and pick up fresh polls.
  setInterval(() => {
    Promise.all([fetchBudget(true), fetchQuota(true)]).then(() => {
      renderBudgetWidget();
      updatePickerBudgetNotice();
      updateAutonomousBudgetNotice();
    });
  }, 2 * 60 * 1000);

  // Annotate agent picker rows whenever it is opened.
  const picker = document.getElementById('agent-picker');
  if (picker) {
    const observer = new MutationObserver(() => {
      if (picker.style.display === 'flex') {
        Promise.all([fetchBudget(), fetchQuota()]).then(() => { updatePickerBudgetNotice(); });
      }
    });
    observer.observe(picker, { attributes: true, attributeFilter: ['style'] });
    picker.addEventListener('change', () => { updatePickerBudgetNotice(); });
  }

  const autonomousModalEl = document.getElementById('autonomous-modal');
  if (autonomousModalEl) {
    const autoObs = new MutationObserver(() => {
      if (autonomousModalEl.style.display === 'flex') {
        Promise.all([fetchBudget(), fetchQuota()]).then(() => { updateAutonomousBudgetNotice(); });
      }
    });
    autoObs.observe(autonomousModalEl, { attributes: true, attributeFilter: ['style'] });
  }
});
