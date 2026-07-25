/* dashboard-esm-processed */
/* global fetch */
/**
 * Settings → Performance Benchmarks matrix (F707).
 * Merged from aigon-pro by F693.
 */

function esc(x) {
    return String(x == null ? '' : x)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const AGENT_META = {
    cc: { name: 'Claude Code', stripe: '#d97706' },
    cx: { name: 'Codex',       stripe: '#10b981' },
    gg: { name: 'Gemini',      stripe: '#3b82f6' },
    op: { name: 'OpenRouter',  stripe: '#a855f7' },
    km: { name: 'Kimi',        stripe: '#64748b' },
    cu: { name: 'Cursor',      stripe: '#f59e0b' },
};
function agentMeta(id) {
    return AGENT_META[id] || { name: String(id || '').toUpperCase(), stripe: '#64748b' };
}

function fmtDur(ms) {
    if (ms == null || Number.isNaN(ms)) return '—';
    if (ms >= 60000) {
        const m = Math.floor(ms / 60000);
        const s = Math.round((ms % 60000) / 1000);
        return s ? `${m}m ${s}s` : `${m}m`;
    }
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return ms + 'ms';
}

function fmtCompactInt(n) {
    if (n == null || Number.isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1000000) return (n / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (abs >= 1000) return (n / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
}

function fmtTokens(n) {
    if (n == null || Number.isNaN(n)) return null;
    return fmtCompactInt(n);
}

function fmtCost(n) {
    if (n == null || Number.isNaN(n)) return null;
    if (Math.abs(n) >= 0.01) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
}

function fmtScore1(n) {
    if (n == null || Number.isNaN(n)) return null;
    return Number(n).toFixed(1);
}

function fmtAgo(iso) {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.round(sec / 60) + 'm ago';
    if (sec < 86400) return Math.round(sec / 3600) + 'h ago';
    return Math.round(sec / 86400) + 'd ago';
}

function fmtAbs(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function phaseTitle(cell) {
    if (!cell || !cell.phases || !cell.phases.length) return '';
    return cell.phases.map((p) => `${p.name}: ${p.ms != null ? p.ms + 'ms' : '—'}`).join('\n');
}

function bucket(ms, fastest, slowest) {
    if (ms == null || fastest == null || slowest == null) return 'mid';
    if (slowest === fastest) return 'fast';
    const t = (ms - fastest) / (slowest - fastest);
    if (t <= 1 / 3) return 'fast';
    if (t <= 2 / 3) return 'mid';
    return 'slow';
}

function relWidth(ms, slowest) {
    if (!ms || !slowest) return 0;
    return Math.max(4, Math.round((ms / slowest) * 100));
}

// Per-operation accessors. Each cell already represents one operation; bench
// files are routed into `cells[kindId]` upstream (taskType `do` → implement,
// `review` → review). Time, tokens, cost, quality, and last-run are read
// straight from that cell — no row-level aggregation across operations.
function opAgg(row, kindId) {
    const cell = row && row.cells && row.cells[kindId];
    if (!cell || cell.ok === false) {
        return { time: null, freshIn: null, out: null, cost: null, quality: null, lastRun: null };
    }
    const tu = cell.tokenUsage || null;
    // Show total input tokens (fresh + cached) so CC's cache-heavy sessions
    // aren't misleadingly shown as 0. freshInputTokens alone is 0 when
    // everything is served from cache.
    const totalIn = tu
        ? (tu.inputTokens != null ? tu.inputTokens
           : tu.freshInputTokens != null && tu.cachedInputTokens != null
               ? tu.freshInputTokens + tu.cachedInputTokens
               : tu.freshInputTokens != null ? tu.freshInputTokens : null)
        : null;
    return {
        time: cell.totalMs != null ? cell.totalMs : null,
        freshIn: totalIn,
        out: tu && tu.outputTokens != null ? tu.outputTokens : null,
        cost: tu && tu.costUsd != null ? tu.costUsd : null,
        quality: cell.quality && cell.quality.score != null ? cell.quality.score : null,
        lastRun: cell.timestamp || null,
    };
}

// Derived value-for-money score per operation. cost and time are min-max
// normalised across the visible non-empty rows in this op block, then
// clamped to [0.05, 1] so the cheapest/fastest don't divide by ~0.
function computeOpValues(rows, kindId) {
    const map = new Map();
    const candidates = [];
    for (const row of rows) {
        const a = opAgg(row, kindId);
        if (a.quality == null || a.cost == null || a.time == null) continue;
        candidates.push({ row, time: a.time, cost: a.cost, quality: a.quality });
    }
    if (candidates.length === 0) return map;
    let minCost = Infinity, maxCost = -Infinity, minTime = Infinity, maxTime = -Infinity;
    for (const c of candidates) {
        if (c.cost < minCost) minCost = c.cost;
        if (c.cost > maxCost) maxCost = c.cost;
        if (c.time < minTime) minTime = c.time;
        if (c.time > maxTime) maxTime = c.time;
    }
    const costSpread = maxCost - minCost;
    const timeSpread = maxTime - minTime;
    for (const c of candidates) {
        const rawCost = costSpread > 0 ? (c.cost - minCost) / costSpread : 1;
        const rawTime = timeSpread > 0 ? (c.time - minTime) / timeSpread : 1;
        const costN = Math.max(0.05, Math.min(1, rawCost));
        const timeN = Math.max(0.05, Math.min(1, rawTime));
        const score = c.quality / (costN * timeN);
        map.set(c.row, { score, costN, timeN, quality: c.quality, cost: c.cost, time: c.time });
    }
    return map;
}

// ── Sort state ────────────────────────────────────────────────────────────

// v2: column ids changed from flat (`tokens_in`, `cost`, `last_run`,
// `kind:<id>`) to namespaced (`op:<kindId>:<field>`). Bumping the storage
// key drops any stale sort selection cleanly.
const LS_KEY = 'benchmark-matrix-sort-v2';

function loadSortState() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return { columnId: null, direction: 'asc' };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { columnId: null, direction: 'asc' };
        return {
            columnId: parsed.columnId || null,
            direction: parsed.direction === 'desc' ? 'desc' : 'asc',
        };
    } catch (_) {
        return { columnId: null, direction: 'asc' };
    }
}

function saveSortState(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {}
}

// Cycle: none → asc → desc → none
function nextSortState(current, clickedId) {
    if (current.columnId !== clickedId) return { columnId: clickedId, direction: 'asc' };
    if (current.direction === 'asc') return { columnId: clickedId, direction: 'desc' };
    return { columnId: null, direction: 'asc' };
}

// ── Cell renderers ────────────────────────────────────────────────────────

function renderTimeCell(cell, stats) {
    const td = document.createElement('td');
    td.className = 'bench-cell';
    if (!cell) {
        td.innerHTML = '<span class="bench-empty">—</span>';
        return td;
    }
    if (cell.ok === false) {
        td.classList.add('bench-cell-fail');
        const badge = document.createElement('span');
        badge.className = 'bench-pill bench-pill-fail';
        badge.textContent = 'Fail';
        td.appendChild(badge);
        const failTip = [
            cell.error ? cell.error : 'Benchmark run did not complete successfully',
            cell.timestamp ? `run: ${fmtAbs(cell.timestamp)}` : '',
            cell.sourceFileRelative || '',
        ].filter(Boolean).join('\n');
        td.title = failTip;
        return td;
    }
    const tier = bucket(cell.totalMs, stats.fastest, stats.slowest);
    td.classList.add('bench-cell-' + tier);
    const bar = document.createElement('span');
    bar.className = 'bench-bar';
    const fill = document.createElement('span');
    fill.className = 'bench-bar-fill';
    fill.style.width = relWidth(cell.totalMs, stats.slowest) + '%';
    bar.appendChild(fill);
    td.appendChild(bar);
    const time = document.createElement('span');
    time.className = 'bench-time';
    time.textContent = fmtDur(cell.totalMs);
    td.appendChild(time);
    const tip = [
        phaseTitle(cell),
        cell.tokenUsage
            ? `tokens: ${fmtCompactInt(cell.tokenUsage.freshInputTokens)} fresh in + ${fmtCompactInt(cell.tokenUsage.cachedInputTokens)} cached in = ${fmtCompactInt((cell.tokenUsage.freshInputTokens||0)+(cell.tokenUsage.cachedInputTokens||0))} total · ${fmtCompactInt(cell.tokenUsage.outputTokens)} out`
            : '',
        cell.tokenUsage && cell.tokenUsage.sessions ? `sessions: ${cell.tokenUsage.sessions}` : '',
        cell.tokenUsage && cell.tokenUsage.costUsd ? `cost: $${cell.tokenUsage.costUsd.toFixed(4)}` : '',
        cell.quality && cell.quality.score != null ? `quality: ${cell.quality.score.toFixed(1)}/10` : '',
        cell.quality && cell.quality.summary ? cell.quality.summary : '',
        cell.quality && cell.quality.judge
            ? `judge: ${cell.quality.judge.agentId || 'unknown'}${cell.quality.judge.model ? ` / ${cell.quality.judge.model}` : ''}`
            : '',
        cell.timestamp ? `run: ${fmtAbs(cell.timestamp)}` : '',
        cell.aigonVersion ? `aigon ${cell.aigonVersion}` : '',
        cell.sourceFileRelative || '',
    ]
        .filter(Boolean)
        .join('\n');
    if (tip) td.title = tip;
    return td;
}

function renderTokenCell(value, fmtFn, tooltip) {
    const td = document.createElement('td');
    td.className = 'bench-token-col';
    const formatted = fmtFn(value);
    if (formatted == null) {
        td.innerHTML = '<span class="bench-empty">—</span>';
    } else {
        const span = document.createElement('span');
        span.className = 'bench-token-val';
        span.textContent = formatted;
        td.appendChild(span);
    }
    if (tooltip) td.title = tooltip;
    return td;
}

function renderQualityCell(score, cell) {
    const td = document.createElement('td');
    td.className = 'bench-token-col';
    const formatted = fmtScore1(score);
    if (formatted == null) {
        td.innerHTML = '<span class="bench-empty">—</span>';
    } else {
        const span = document.createElement('span');
        span.className = 'bench-token-val';
        span.textContent = formatted;
        td.appendChild(span);
    }
    const tip = [
        'Quality score 0–10 — judge rubric.',
        cell && cell.quality && cell.quality.summary ? cell.quality.summary : '',
        cell && cell.quality && cell.quality.judge
            ? `judge: ${cell.quality.judge.agentId || 'unknown'}${cell.quality.judge.model ? ` / ${cell.quality.judge.model}` : ''}`
            : '',
    ].filter(Boolean).join('\n');
    td.title = tip;
    return td;
}

function renderLastRunCell(iso) {
    const td = document.createElement('td');
    td.className = 'bench-last-cell';
    if (iso) {
        td.innerHTML = '<span class="bench-ago">' + esc(fmtAgo(iso)) + '</span>';
        td.title = fmtAbs(iso);
    } else {
        td.innerHTML = '<span class="bench-empty">—</span>';
    }
    return td;
}

function renderValueCell(v) {
    const td = document.createElement('td');
    td.className = 'bench-token-col';
    if (!v) {
        td.innerHTML = '<span class="bench-empty">—</span>';
        return td;
    }
    const span = document.createElement('span');
    span.className = 'bench-token-val';
    span.textContent = v.score.toFixed(1);
    td.appendChild(span);
    td.title = [
        'Value = quality / (cost_norm × time_norm); cost and time are min-max normalised across visible rows in this operation block (clamped to [0.05, 1]).',
        `quality: ${v.quality.toFixed(1)}`,
        `cost: ${fmtCost(v.cost)} (norm ${v.costN.toFixed(2)})`,
        `time: ${fmtDur(v.time)} (norm ${v.timeN.toFixed(2)})`,
    ].join('\n');
    return td;
}

// ── Stats & helpers ───────────────────────────────────────────────────────

function computeStats(rows, kindId) {
    let fastest = null;
    let slowest = null;
    let count = 0;
    let latest = null;
    for (const r of rows) {
        const c = r.cells && r.cells[kindId];
        if (!c || c.ok === false || c.totalMs == null) continue;
        count++;
        if (fastest == null || c.totalMs < fastest) fastest = c.totalMs;
        if (slowest == null || c.totalMs > slowest) slowest = c.totalMs;
        if (c.timestamp) {
            const t = Date.parse(c.timestamp);
            if (!Number.isNaN(t) && (!latest || t > latest)) latest = t;
        }
    }
    return { fastest, slowest, count, latest };
}

function groupByAgent(rows) {
    const groups = [];
    let cur = null;
    for (const r of rows) {
        if (!cur || cur.agentId !== r.agentId) {
            cur = { agentId: r.agentId, rows: [] };
            groups.push(cur);
        }
        cur.rows.push(r);
    }
    return groups;
}

// ── Op block schema ───────────────────────────────────────────────────────
// Per-operation column descriptors. Ordering here drives header order, body
// cell order, and sort id namespacing (`op:<kindId>:<field>`).
const OP_FIELDS = [
    { id: 'time',       label: 'Time',       isNum: true, tooltip: null },
    { id: 'tokens_in',  label: 'tokens in',  isNum: true, tooltip: 'Total input tokens sent (fresh + cached). CC models cache their context heavily so most input is free cache-reads — cost reflects this discount. CX/GG have no caching so all input is billed at full rate.' },
    { id: 'tokens_out', label: 'tokens out', isNum: true, tooltip: null },
    { id: 'cost',       label: '$',          isNum: true, tooltip: null },
    { id: 'quality',    label: 'Quality',    isNum: true, tooltip: 'Judge score 0–10 from the bench rubric (— if no rubric ran).' },
    { id: 'last_run',   label: 'Last run',   isNum: true, tooltip: 'Timestamp of the newest bench file for this operation only.' },
    { id: 'value',      label: 'Value',      isNum: true, tooltip: 'Quality ÷ (cost_norm × time_norm); cost and time are min-max normalised across visible rows in this operation block (clamped to [0.05, 1]).' },
];
const OP_FIELD_COUNT = OP_FIELDS.length;

// ── Sorting ───────────────────────────────────────────────────────────────

function buildSortValueFn(columnId, opValueMaps) {
    if (!columnId) return null;
    if (columnId === 'agent') return (row) => String(row.agentId || '').toLowerCase();
    if (columnId === 'model') return (row) => String(row.modelLabel || row.modelValue || '').toLowerCase();
    if (columnId.startsWith('op:')) {
        // Format: op:<kindId>:<field>
        const rest = columnId.slice(3);
        const sep = rest.indexOf(':');
        if (sep < 0) return null;
        const kindId = rest.slice(0, sep);
        const field = rest.slice(sep + 1);
        if (field === 'value') {
            const m = opValueMaps[kindId];
            return (row) => {
                const v = m && m.get(row);
                return v ? v.score : null;
            };
        }
        return (row) => {
            const a = opAgg(row, kindId);
            switch (field) {
                case 'time':       return a.time;
                case 'tokens_in':  return a.freshIn;
                case 'tokens_out': return a.out;
                case 'cost':       return a.cost;
                case 'quality':    return a.quality;
                case 'last_run':   return a.lastRun ? Date.parse(a.lastRun) : null;
                default:           return null;
            }
        };
    }
    return null;
}

function sortRows(rows, sortState, opValueMaps) {
    if (!sortState.columnId) return rows.slice();
    const fn = buildSortValueFn(sortState.columnId, opValueMaps);
    if (!fn) return rows.slice();
    const dir = sortState.direction === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
        const av = fn(a);
        const bv = fn(b);
        // Nulls always sort to the bottom regardless of direction; otherwise
        // descending Quality / Value would float em-dash rows above real
        // scores, which defeats the point of sorting by them.
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string') return dir * av.localeCompare(bv);
        return dir * (av - bv);
    });
}

// ── Summary ───────────────────────────────────────────────────────────────

function renderSummary(host, data, stats) {
    const fastest = Math.min.apply(null, stats.map((s) => s.fastest).filter((v) => v != null).concat(Infinity));
    const slowest = Math.max.apply(null, stats.map((s) => s.slowest).filter((v) => v != null).concat(-Infinity));
    const totalRuns = stats.reduce((acc, s) => acc + s.count, 0);
    const latestTs = stats.reduce((acc, s) => (s.latest && (!acc || s.latest > acc) ? s.latest : acc), null);
    const totalRows = data.rows.length;
    const stripStats = [
        { label: 'Models tracked', value: String(totalRows) },
        { label: 'Runs recorded', value: String(totalRuns) },
        { label: 'Fastest', value: fastest === Infinity ? '—' : fmtDur(fastest) },
        { label: 'Slowest', value: slowest === -Infinity ? '—' : fmtDur(slowest) },
        { label: 'Last run', value: latestTs ? fmtAgo(new Date(latestTs).toISOString()) : '—' },
    ];
    const strip = document.createElement('div');
    strip.className = 'bench-summary';
    strip.innerHTML = stripStats.map((s) =>
        `<div class="bench-summary-stat"><span class="bench-summary-num">${esc(s.value)}</span><span class="bench-summary-label">${esc(s.label)}</span></div>`
    ).join('');
    host.appendChild(strip);
}

function shortPath(p) {
    if (!p) return '';
    const home = '/Users/' + (p.split('/Users/')[1] || '').split('/')[0];
    return home && p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

function renderSourceRepoBanner(host, data) {
    if (!data.sourceRepo) return;
    const banner = document.createElement('div');
    banner.className = 'bench-source-banner';
    if (data.sourceRepoFellBack) {
        banner.classList.add('bench-source-banner-fallback');
        banner.innerHTML =
            '<span class="bench-source-label">Reading from</span> ' +
            '<code>' + esc(shortPath(data.sourceRepo)) + '</code>' +
            ' <span class="bench-source-note">— no benchmarks in <code>' + esc(shortPath(data.requestedRepo || '')) + '</code>, falling back to the first registered repo with data.</span>';
    } else {
        banner.innerHTML =
            '<span class="bench-source-label">Reading from</span> ' +
            '<code>' + esc(shortPath(data.sourceRepo)) + '</code>';
    }
    host.appendChild(banner);
}

// ── Op toggle (Implementation / Review tab bar) ───────────────────────────

function renderOpToggle(host, allKinds, visibleKind, onKindChange) {
    if (allKinds.length < 2) return;
    const bar = document.createElement('div');
    bar.className = 'pipeline-type-toggle';
    bar.style.marginBottom = '10px';

    const buttons = [{ id: null, label: 'All' }].concat(allKinds);
    buttons.forEach(({ id, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toggle-btn' + (visibleKind === id ? ' active' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => { if (visibleKind !== id) onKindChange(id); });
        bar.appendChild(btn);
    });

    host.appendChild(bar);
}

// ── Table ─────────────────────────────────────────────────────────────────

function renderTable(host, data, sortState, visibleKind, onSortChange, onKindChange) {
    host.innerHTML = '';

    const allKinds = data.kinds && data.kinds.length ? data.kinds : [
        { id: 'implement', label: 'Implementation' },
        { id: 'review', label: 'Review' },
    ];
    const kinds = visibleKind ? allKinds.filter((k) => k.id === visibleKind) : allKinds;
    const stats = kinds.map((k) => computeStats(data.rows, k.id));
    const opValueMaps = {};
    kinds.forEach((k) => { opValueMaps[k.id] = computeOpValues(data.rows, k.id); });

    renderSourceRepoBanner(host, data);
    renderSummary(host, data, stats);
    renderOpToggle(host, allKinds, visibleKind, onKindChange);

    const wrap = document.createElement('div');
    wrap.className = 'bench-table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'bench-table';

    // ── Colgroups: one for fixed cols (agent, model), one per op block ───
    const fixedCg = document.createElement('colgroup');
    fixedCg.className = 'bench-cg-fixed';
    fixedCg.appendChild(document.createElement('col'));
    fixedCg.appendChild(document.createElement('col'));
    tbl.appendChild(fixedCg);
    kinds.forEach((k, ki) => {
        const cg = document.createElement('colgroup');
        cg.className = 'bench-cg-op bench-cg-op-' + (ki % 2 === 0 ? 'a' : 'b');
        cg.dataset.kind = k.id;
        for (let i = 0; i < OP_FIELD_COUNT; i++) cg.appendChild(document.createElement('col'));
        tbl.appendChild(cg);
    });

    // ── Header (two rows) ─────────────────────────────────────────────────
    const thead = document.createElement('thead');

    // Top row: agent & model span 2 rows; each op label spans OP_FIELD_COUNT
    const topRow = document.createElement('tr');
    topRow.className = 'bench-head-top';

    const thAgentTop = document.createElement('th');
    thAgentTop.rowSpan = 2;
    thAgentTop.className = 'bench-head-fixed';
    const btnAgent = makeSortBtn('agent', 'Agent', false, null, sortState, onSortChange);
    thAgentTop.appendChild(btnAgent);
    topRow.appendChild(thAgentTop);

    const thModelTop = document.createElement('th');
    thModelTop.rowSpan = 2;
    thModelTop.className = 'bench-head-fixed';
    const btnModel = makeSortBtn('model', 'Model', false, null, sortState, onSortChange);
    thModelTop.appendChild(btnModel);
    topRow.appendChild(thModelTop);

    kinds.forEach((k, ki) => {
        const th = document.createElement('th');
        th.colSpan = OP_FIELD_COUNT;
        th.className = 'bench-head-op bench-head-op-' + (ki % 2 === 0 ? 'a' : 'b');
        th.textContent = k.label;
        topRow.appendChild(th);
    });
    thead.appendChild(topRow);

    // Bottom row: per-op sortable column headers
    const botRow = document.createElement('tr');
    botRow.className = 'bench-head-sub';
    kinds.forEach((k, ki) => {
        OP_FIELDS.forEach((f, fi) => {
            const colId = 'op:' + k.id + ':' + f.id;
            const th = makeSortTh(colId, f.label, f.isNum, f.tooltip, sortState, onSortChange);
            th.classList.add('bench-head-op-' + (ki % 2 === 0 ? 'a' : 'b'));
            if (fi === 0) th.classList.add('bench-head-op-first');
            if (fi === OP_FIELD_COUNT - 1) th.classList.add('bench-head-op-last');
            botRow.appendChild(th);
        });
    });
    thead.appendChild(botRow);

    tbl.appendChild(thead);

    // ── Body ──────────────────────────────────────────────────────────────
    const tbody = document.createElement('tbody');
    const isSorted = !!sortState.columnId;
    const displayRows = isSorted
        ? sortRows(data.rows, sortState, opValueMaps)
        : data.rows;

    function appendOpCells(tr, row, ki) {
        const k = kinds[ki];
        const kindStats = stats[ki];
        const cell = row.cells && row.cells[k.id];
        const a = opAgg(row, k.id);
        const v = opValueMaps[k.id].get(row);

        tr.appendChild(decorateOpCell(renderTimeCell(cell, kindStats), ki, 'first'));
        tr.appendChild(decorateOpCell(renderTokenCell(a.freshIn, fmtTokens, 'Uncached input tokens — fresh context billed this run.'), ki));
        tr.appendChild(decorateOpCell(renderTokenCell(a.out, fmtTokens, null), ki));
        tr.appendChild(decorateOpCell(renderTokenCell(a.cost, fmtCost, null), ki));
        tr.appendChild(decorateOpCell(renderQualityCell(a.quality, cell), ki));
        tr.appendChild(decorateOpCell(renderLastRunCell(a.lastRun), ki));
        tr.appendChild(decorateOpCell(renderValueCell(v), ki, 'last'));
    }

    if (isSorted) {
        // Flat sorted view — each row gets its own agent cell (no rowspan)
        displayRows.forEach((row) => {
            const tr = document.createElement('tr');
            tr.className = 'bench-row bench-row-sorted';

            const meta = agentMeta(row.agentId);
            const aTd = document.createElement('td');
            aTd.className = 'bench-agent-cell bench-agent-cell-flat';
            aTd.style.setProperty('--agent-stripe', meta.stripe);
            aTd.innerHTML =
                '<div class="bench-agent-stripe"></div>' +
                '<div class="bench-agent-body">' +
                '<span class="bench-agent-id">' + esc(String(row.agentId).toUpperCase()) + '</span>' +
                '</div>';
            tr.appendChild(aTd);

            tr.appendChild(buildModelCell(row));

            kinds.forEach((_k, ki) => appendOpCells(tr, row, ki));

            tbody.appendChild(tr);
        });
    } else {
        // Grouped by agent view (default)
        const groups = groupByAgent(displayRows);
        groups.forEach((g, gi) => {
            const meta = agentMeta(g.agentId);
            g.rows.forEach((row, i) => {
                const tr = document.createElement('tr');
                tr.className = 'bench-row';
                if (gi % 2 === 1) tr.classList.add('bench-row-alt');
                if (i === 0) tr.classList.add('bench-row-group-start');
                if (i === g.rows.length - 1) tr.classList.add('bench-row-group-end');

                if (i === 0) {
                    const aTd = document.createElement('td');
                    aTd.className = 'bench-agent-cell';
                    aTd.rowSpan = g.rows.length;
                    aTd.style.setProperty('--agent-stripe', meta.stripe);
                    aTd.innerHTML =
                        '<div class="bench-agent-stripe"></div>' +
                        '<div class="bench-agent-body">' +
                        '<span class="bench-agent-id">' + esc(String(g.agentId).toUpperCase()) + '</span>' +
                        '<span class="bench-agent-name">' + esc(meta.name) + '</span>' +
                        '<span class="bench-agent-count">' + g.rows.length + ' model' + (g.rows.length === 1 ? '' : 's') + '</span>' +
                        '</div>';
                    tr.appendChild(aTd);
                }

                tr.appendChild(buildModelCell(row));

                kinds.forEach((_k, ki) => appendOpCells(tr, row, ki));

                tbody.appendChild(tr);
            });
        });
    }

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    host.appendChild(wrap);

    const foot = document.createElement('div');
    foot.className = 'bench-footnote';
    foot.innerHTML =
        '<span class="bench-foot-key bench-cell-fast"></span> fastest tier · ' +
        '<span class="bench-foot-key bench-cell-mid"></span> mid · ' +
        '<span class="bench-foot-key bench-cell-slow"></span> slowest tier · ' +
        '<span class="bench-foot-key bench-cell-fail"></span> failed run · ' +
        'bar width is relative to the slowest run in this column · ' +
        'click any column header to sort · click again to reverse · click a third time to reset.';
    host.appendChild(foot);
}

function decorateOpCell(td, ki, edge) {
    td.classList.add('bench-op-' + (ki % 2 === 0 ? 'a' : 'b'));
    if (edge === 'first') td.classList.add('bench-op-first');
    if (edge === 'last') td.classList.add('bench-op-last');
    return td;
}

function buildModelCell(row) {
    const mTd = document.createElement('td');
    mTd.className = 'bench-model-cell';
    let label = row.modelLabel || row.modelValue || 'default';
    // "default" means no model override — show the resolved model from telemetry
    // so the user knows which model actually ran, not just "default".
    if (label === 'default' || label === 'Default') {
        const resolvedModel = row.cells && (
            (row.cells.implement && row.cells.implement.tokenUsage && row.cells.implement.tokenUsage.model) ||
            (row.cells.review    && row.cells.review.tokenUsage    && row.cells.review.tokenUsage.model)
        );
        if (resolvedModel) label = 'Default (' + resolvedModel + ')';
        else mTd.title = 'No model override — uses whichever model is set as default in your global ~/.aigon/config.json';
    }
    const value = row.modelValue || '';
    mTd.innerHTML =
        '<div class="bench-model-name">' + esc(label) + '</div>' +
        (value && value !== label
            ? '<div class="bench-model-id">' + esc(value) + '</div>'
            : '');
    return mTd;
}

function makeSortBtn(colId, label, isNum, tooltip, sortState, onSortChange) {
    const btn = document.createElement('button');
    btn.className = 'bench-sort-btn';
    btn.type = 'button';
    if (tooltip) btn.title = tooltip;
    if (isNum) btn.classList.add('bench-sort-btn-num');

    const isActive = sortState.columnId === colId;
    const ariaSort = isActive ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none';
    btn.setAttribute('aria-sort', ariaSort);

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);

    if (tooltip) {
        const info = document.createElement('span');
        info.className = 'bench-col-info';
        info.textContent = '?';
        info.setAttribute('aria-hidden', 'true');
        btn.appendChild(info);
    }

    if (isActive) {
        const arrow = document.createElement('span');
        arrow.className = 'bench-sort-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = sortState.direction === 'asc' ? ' ▲' : ' ▼';
        btn.appendChild(arrow);
    }

    btn.addEventListener('click', () => {
        const next = nextSortState(sortState, colId);
        onSortChange(next);
    });
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const next = nextSortState(sortState, colId);
            onSortChange(next);
        }
    });
    return btn;
}

function makeSortTh(colId, label, isNum, tooltip, sortState, onSortChange) {
    const th = document.createElement('th');
    if (isNum) th.classList.add('bench-col-num');
    const btn = makeSortBtn(colId, label, isNum, tooltip, sortState, onSortChange);
    th.appendChild(btn);
    return th;
}

/**
 * @param {HTMLElement} section settings section body
 * @param {() => string} getRepoPath absolute path of repo whose `.aigon/benchmarks` to read
 */
function mount(section, getRepoPath) {
    const wrap = document.createElement('div');
    wrap.className = 'bench-section';
    section.appendChild(wrap);

    let sortState = loadSortState();
    let visibleKind = null; // null = All, or a kind id string ('implement', 'review')
    let lastData = null;

    function show(msg, isHtml) {
        wrap.innerHTML = '';
        const p = document.createElement('div');
        p.className = 'settings-empty';
        if (isHtml) p.innerHTML = msg;
        else p.textContent = msg;
        wrap.appendChild(p);
    }

    function render(data) {
        lastData = data;
        wrap.innerHTML = '';
        renderTable(wrap, data, sortState, visibleKind,
            (next) => { sortState = next; saveSortState(sortState); render(lastData); },
            (kind) => { visibleKind = kind; render(lastData); }
        );
    }

    function load() {
        const repoPath = typeof getRepoPath === 'function' ? getRepoPath() : '';
        if (!repoPath) {
            show('Pick a repository in Repository Settings (defaults scope) or add a conductor repo — benchmarks are read from .aigon/benchmarks under that path.', false);
            return;
        }
        show('<span class="toast-spinner"></span> Loading…', true);
        const url = '/api/benchmarks/latest?repoPath=' + encodeURIComponent(repoPath);
        fetch(url, { cache: 'no-store' })
            .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d })))
            .then(({ ok, status, d }) => {
                if (!ok) {
                    show('Failed to load: ' + esc(d.error || ('HTTP ' + status)), true);
                    return;
                }
                wrap.innerHTML = '';
                if (!d.rows || d.rows.length === 0) {
                    show(
                        'No benchmark rows yet. Run <code>aigon perf-bench brewboard &lt;agent&gt;</code> or <code>aigon perf-bench brewboard-review &lt;agent&gt;</code>; JSON is written under <code>.aigon/benchmarks/</code> in this repo.',
                        true,
                    );
                    return;
                }
                render(d);
            })
            .catch((e) => {
                show('Failed to load: ' + esc(e.message), true);
            });
    }

    load();
}

export { mount as mountBenchmarkMatrix };
