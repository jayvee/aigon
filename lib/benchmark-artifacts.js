'use strict';

/**
 * Read-model for `.aigon/benchmarks/*.json` produced by `aigon perf-bench`.
 * Discriminates benchmark kinds by **seed + featureId** (see lib/perf-bench.js
 * DEFAULT_SEEDS) — not only taskType, which may be generic in older runs.
 */

const fs = require('fs');
const path = require('path');

const BENCHMARK_KINDS = [
    { id: 'implement', seed: 'brewboard', featureId: '07', label: 'Implementation' },
    { id: 'review', seed: 'brewboard-review', featureId: '08', label: 'Review' },
];

function getBenchmarksDir(repoPath) {
    return path.join(repoPath, '.aigon', 'benchmarks');
}

function listBenchmarkJsonFiles(repoPath) {
    const dir = getBenchmarksDir(repoPath);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json') && f !== 'baseline.json' && !f.startsWith('all-'))
        .map((f) => path.join(dir, f));
}

function listAggregateJsonFiles(repoPath) {
    const dir = getBenchmarksDir(repoPath);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json') && f.startsWith('all-'))
        .map((f) => path.join(dir, f));
}

function repoHasBenchmarks(repoPath) {
    return listBenchmarkJsonFiles(repoPath).length > 0
        || listAggregateJsonFiles(repoPath).length > 0;
}

function aggregateKindFromFilename(filename) {
    const base = path.basename(filename);
    for (const k of BENCHMARK_KINDS) {
        if (base.startsWith('all-' + k.seed + '-') || base === 'all-' + k.seed + '.json') return k.id;
    }
    return null;
}

function parseResultFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function matchKind(record) {
    if (!record || typeof record !== 'object') return null;
    const seed = String(record.seed || '');
    const featureId = String(record.featureId || '');
    for (const k of BENCHMARK_KINDS) {
        if (seed === k.seed && featureId === k.featureId) return k.id;
    }
    return null;
}

function timeKey(record, filePath) {
    const ts = record && record.timestamp;
    if (ts) {
        const d = new Date(ts).getTime();
        if (!Number.isNaN(d)) return d;
    }
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (_) {
        return 0;
    }
}

function pairKey(agentId, modelValue) {
    return `${String(agentId || '')}\0${modelValue == null ? '' : String(modelValue)}`;
}

function normalizeTokenUsage(tokenUsage) {
    if (!tokenUsage || typeof tokenUsage !== 'object') return null;
    const inputTokens = Number(tokenUsage.inputTokens || 0);
    const cachedInputTokens = Number(tokenUsage.cachedInputTokens || 0);
    const freshInputTokens = Number(
        tokenUsage.freshInputTokens != null
            ? tokenUsage.freshInputTokens
            : Math.max(0, inputTokens - cachedInputTokens)
    );
    const outputTokens = Number(tokenUsage.outputTokens || 0);
    const thinkingTokens = Number(tokenUsage.thinkingTokens || 0);
    const totalTokens = Number(tokenUsage.totalTokens || 0);
    const billableTokens = Number(
        tokenUsage.billableTokens != null
            ? tokenUsage.billableTokens
            : inputTokens + outputTokens + thinkingTokens
    );
    const sessions = Number(tokenUsage.sessions || 0);
    const costUsd = Number(tokenUsage.costUsd || 0);
    const model = tokenUsage.model != null ? String(tokenUsage.model) : null;
    const hasAnyData = inputTokens > 0 || cachedInputTokens > 0 || outputTokens > 0 || thinkingTokens > 0 || totalTokens > 0 || billableTokens > 0 || sessions > 0 || costUsd > 0;
    if (!hasAnyData && !model) return null;
    return {
        inputTokens,
        cachedInputTokens,
        freshInputTokens,
        outputTokens,
        thinkingTokens,
        totalTokens,
        billableTokens,
        sessions,
        costUsd: Math.round(costUsd * 10000) / 10000,
        model,
    };
}

function normalizeQuality(quality) {
    if (!quality || typeof quality !== 'object') return null;
    const score = quality.score != null ? Number(quality.score) : null;
    if (score == null || Number.isNaN(score)) return null;
    return {
        kind: quality.kind || 'implementation',
        rubricId: quality.rubricId || null,
        rubricVersion: quality.rubricVersion || null,
        score: Math.round(score * 100) / 100,
        summary: quality.summary || '',
        judge: quality.judge || null,
        assessedAt: quality.assessedAt || null,
    };
}

function collectRegistryPairs() {
    try {
        const perfBench = require('./perf-bench');
        if (perfBench && typeof perfBench.collectAllPairs === 'function') {
            return perfBench.collectAllPairs([]);
        }
    } catch (_) {
        /* optional dependency — tests / minimal installs */
    }
    return [];
}

/**
 * @param {string} repoPath absolute repo root (where `.aigon/benchmarks` lives)
 * @returns {{ kinds: object[], rows: object[] }}
 */
function buildLatestMatrix(repoPath) {
    const abs = path.resolve(repoPath);
    const files = listBenchmarkJsonFiles(abs);
    /** @type {Map<string, Map<string, { record: object, tk: number, rel: string }>>} */
    const latest = new Map();
    for (const k of BENCHMARK_KINDS) latest.set(k.id, new Map());

    for (const filePath of files) {
        const record = parseResultFile(filePath);
        const kindId = matchKind(record);
        if (!kindId || record.agent == null) continue;

        const agent = String(record.agent || '');
        const modelVal = record.model == null ? '' : String(record.model);
        const pk = pairKey(agent, modelVal === '' ? null : modelVal);
        const tk = timeKey(record, filePath);
        const rel = path.relative(abs, filePath).replace(/\\/g, '/');

        const m = latest.get(kindId);
        const prev = m.get(pk);
        if (!prev || tk > prev.tk) {
            m.set(pk, { record, tk, rel });
        }
    }

    // Pull in aggregate `all-<seed>-*.json` files for pairs not present as
    // individual runs — they often carry failure context (error strings) that
    // would otherwise be lost when a run aborts before producing a per-pair file.
    /** @type {Map<string, string>} pair-key → human label seen in aggregate */
    const aggLabels = new Map();
    const aggFiles = listAggregateJsonFiles(abs);
    for (const aggPath of aggFiles) {
        const kindId = aggregateKindFromFilename(aggPath);
        if (!kindId) continue;
        const blob = parseResultFile(aggPath);
        if (!blob || !Array.isArray(blob.pairs)) continue;
        const aggTk = (() => {
            try { return fs.statSync(aggPath).mtimeMs; } catch (_) { return 0; }
        })();
        const rel = path.relative(abs, aggPath).replace(/\\/g, '/');
        const tsIso = (() => {
            const m = path.basename(aggPath).match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)/);
            if (!m) return null;
            const iso = m[1].replace(/-(\d{2})-(\d{2})-(\d+)Z$/, ':$1:$2.$3Z');
            const t = Date.parse(iso);
            return Number.isNaN(t) ? null : new Date(t).toISOString();
        })();
        for (const p of blob.pairs) {
            const agent = String(p.agentId || '');
            const modelVal = p.modelValue == null ? '' : String(p.modelValue);
            const pk = pairKey(agent, modelVal === '' ? null : modelVal);
            if (p.modelLabel) aggLabels.set(pk, String(p.modelLabel));
            const m = latest.get(kindId);
            if (m.has(pk)) continue;
            m.set(pk, {
                record: {
                    agent,
                    model: modelVal || null,
                    totalMs: p.totalMs != null ? p.totalMs : null,
                    ok: p.ok !== false,
                    error: p.error || null,
                    timestamp: tsIso,
                    aigonVersion: blob.aigonVersion || null,
                },
                tk: aggTk,
                rel,
            });
        }
    }

    const registryPairs = collectRegistryPairs();
    const rowKeys = new Set();
    for (const p of registryPairs) {
        rowKeys.add(pairKey(p.agentId, p.modelValue));
    }
    for (const m of latest.values()) {
        for (const pk of m.keys()) rowKeys.add(pk);
    }

    const order = new Map();
    let ord = 0;
    for (const p of registryPairs) {
        order.set(pairKey(p.agentId, p.modelValue), ord++);
    }

    const sortedKeys = Array.from(rowKeys).sort((a, b) => {
        const oa = order.has(a) ? order.get(a) : 1e9;
        const ob = order.has(b) ? order.get(b) : 1e9;
        if (oa !== ob) return oa - ob;
        const [aAgent, aModel] = a.split('\0');
        const [bAgent, bModel] = b.split('\0');
        if (aAgent !== bAgent) return aAgent.localeCompare(bAgent);
        return String(aModel).localeCompare(String(bModel));
    });

    const rows = [];
    for (const pk of sortedKeys) {
        const sep = pk.indexOf('\0');
        const agentId = pk.slice(0, sep);
        const modelRaw = pk.slice(sep + 1);
        const modelValue = modelRaw === '' ? null : modelRaw;

        const reg = registryPairs.find(
            (p) => p.agentId === agentId && String(p.modelValue || '') === String(modelValue || ''),
        );
        let modelLabel = reg ? reg.modelLabel : (aggLabels.get(pk) || modelValue || 'default');

        const entryImplement = latest.get('implement').get(pk);
        const entryReview = latest.get('review').get(pk);
        if (!reg && entryImplement && !modelValue) {
            modelLabel = entryImplement.record.model != null ? String(entryImplement.record.model) : 'default';
        }
        if (!reg && !entryImplement && entryReview && !modelValue) {
            modelLabel = entryReview.record.model != null ? String(entryReview.record.model) : 'default';
        }

        const cells = { implement: null, review: null };
        for (const kind of BENCHMARK_KINDS) {
            const entry = latest.get(kind.id).get(pk);
            if (!entry) continue;
            const r = entry.record;
            cells[kind.id] = {
                timestamp: r.timestamp || null,
                totalMs: r.totalMs != null ? r.totalMs : null,
                phases: Array.isArray(r.phases) ? r.phases : null,
                ok: r.ok !== false,
                error: r.error || null,
                tokenUsage: normalizeTokenUsage(r.tokenUsage),
                quality: normalizeQuality(r.quality),
                sourceFileRelative: entry.rel,
                aigonVersion: r.aigonVersion || null,
                effort: r.effort != null ? r.effort : null,
            };
        }
        rows.push({ agentId, modelValue, modelLabel, cells });
    }

    // Merge null-model ("default") rows into their matching named model rows.
    // A null-model row is a benchmark run with no explicit --model flag; the
    // resolved model lives in cells[kind].tokenUsage.model. If a named row for
    // that model already exists in the same agent group, fold the fresher of the
    // two benchmark cells into the named row and drop the null row entirely.
    const namedIndex = new Map(); // `${agentId}\0${modelValue}` → row index
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.modelValue) namedIndex.set(`${r.agentId}\0${r.modelValue}`, i);
    }
    const toRemove = new Set();
    for (let i = 0; i < rows.length; i++) {
        const nullRow = rows[i];
        if (nullRow.modelValue) continue; // only process null-model rows
        for (const kind of BENCHMARK_KINDS) {
            const nullCell = nullRow.cells[kind.id];
            if (!nullCell || !nullCell.tokenUsage || !nullCell.tokenUsage.model) continue;
            const resolvedModel = String(nullCell.tokenUsage.model);
            const namedIdx = namedIndex.get(`${nullRow.agentId}\0${resolvedModel}`);
            if (namedIdx == null) continue;
            const namedRow = rows[namedIdx];
            const namedCell = namedRow.cells[kind.id];
            // Keep the fresher cell
            const nullTs = nullCell.timestamp ? new Date(nullCell.timestamp).getTime() : 0;
            const namedTs = namedCell && namedCell.timestamp ? new Date(namedCell.timestamp).getTime() : 0;
            if (nullTs > namedTs) namedRow.cells[kind.id] = nullCell;
            toRemove.add(i);
        }
    }
    const dedupedRows = rows.filter((_, i) => !toRemove.has(i));

    return {
        kinds: BENCHMARK_KINDS.map(({ id, seed, featureId, label }) => ({ id, seed, featureId, label })),
        rows: dedupedRows,
    };
}

module.exports = {
    getBenchmarksDir,
    listBenchmarkJsonFiles,
    listAggregateJsonFiles,
    repoHasBenchmarks,
    buildLatestMatrix,
    matchKind,
    BENCHMARK_KINDS,
    _pairKey: pairKey,
};
