'use strict';

// F456: Read-path extension for the F444 quota model. Scans
// .aigon/benchmarks/ on each call and returns a per-(agent, model) bench
// verdict ('passed' | 'failed' | 'unknown') with timestamp + totalMs.
// Single-turn probe (F444) shows the API responds; bench shows the model
// can drive a multi-turn agent loop. Both signals are needed for "green".

const fs = require('fs');
const path = require('path');

function benchKey(agentId, modelValue) {
    return `${agentId}::${modelValue || '__default__'}`;
}

function readJsonSafe(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function classifyVerdict(ok) {
    if (ok === true) return 'passed';
    if (ok === false) return 'failed';
    return 'unknown';
}

function tsValue(iso) {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t : 0;
}

function hydrateBenchVerdicts(repoPath = process.cwd()) {
    const dir = path.join(repoPath, '.aigon', 'benchmarks');
    if (!fs.existsSync(dir)) return {};

    let files;
    try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    } catch (_) {
        return {};
    }

    // Two layers: all-pairs (sweep, authoritative) and per-run.
    const allPairs = new Map(); // key → { ok, totalMs, timestamp }
    const perRun = new Map();

    for (const name of files) {
        const data = readJsonSafe(path.join(dir, name));
        if (!data || typeof data !== 'object') continue;

        if (Array.isArray(data.pairs)) {
            const ts = data.timestamp || null;
            for (const pair of data.pairs) {
                if (!pair || !pair.agentId) continue;
                const key = benchKey(pair.agentId, pair.modelValue);
                const prev = allPairs.get(key);
                if (!prev || tsValue(ts) > tsValue(prev.timestamp)) {
                    allPairs.set(key, {
                        ok: pair.ok,
                        totalMs: typeof pair.totalMs === 'number' ? pair.totalMs : null,
                        timestamp: ts,
                        source: name,
                    });
                }
            }
            continue;
        }

        if (data.agent) {
            const key = benchKey(data.agent, data.model);
            const ts = data.timestamp || null;
            const prev = perRun.get(key);
            if (!prev || tsValue(ts) > tsValue(prev.timestamp)) {
                perRun.set(key, {
                    ok: data.ok,
                    totalMs: typeof data.totalMs === 'number' ? data.totalMs : null,
                    timestamp: ts,
                    source: name,
                });
            }
        }
    }

    // All-pairs trumps per-run for the same pair (sweep is authoritative).
    const out = {};
    const merged = new Map();
    for (const [key, entry] of perRun) merged.set(key, entry);
    for (const [key, entry] of allPairs) merged.set(key, entry);

    for (const [key, entry] of merged) {
        out[key] = {
            benchVerdict: classifyVerdict(entry.ok),
            lastBenchAt: entry.timestamp || null,
            benchTotalMs: entry.totalMs,
            lastBenchSource: entry.source ? path.join('.aigon', 'benchmarks', entry.source) : null,
        };
    }
    return out;
}

// Merge bench verdicts into a quota state (in place). Pairs without bench
// data get benchVerdict: 'unknown' so the dashboard always sees the field.
function mergeBenchVerdictsIntoQuota(state, repoPath = process.cwd()) {
    if (!state || !state.agents) return state;
    const index = hydrateBenchVerdicts(repoPath);
    for (const [agentId, agent] of Object.entries(state.agents)) {
        const models = (agent && agent.models) || {};
        for (const [modelKey, entry] of Object.entries(models)) {
            const lookupValue = modelKey === '__default__' ? null : modelKey;
            const found = index[benchKey(agentId, lookupValue)];
            if (found) {
                Object.assign(entry, found);
            } else {
                entry.benchVerdict = 'unknown';
                entry.lastBenchAt = null;
                entry.benchTotalMs = null;
                entry.lastBenchSource = null;
            }
        }
    }
    return state;
}

module.exports = { hydrateBenchVerdicts, mergeBenchVerdictsIntoQuota, benchKey };
