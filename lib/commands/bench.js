'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_STALENESS_DAYS = { gg: 30, op: 30, cc: 60, cx: 60 };
const AGENTS_DIR = path.join(__dirname, '..', '..', 'templates', 'agents');

// --- Helpers ---

function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = new URL(url);
        const req = https.get({
            hostname: options.hostname,
            path: options.pathname + options.search,
            headers: { 'User-Agent': 'aigon-bench-refresh/1.0', ...headers },
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(30_000, () => { req.destroy(new Error('Request timed out')); });
    });
}

function loadAgentJson(agentId) {
    const fpath = path.join(AGENTS_DIR, `${agentId}.json`);
    if (!fs.existsSync(fpath)) return null;
    try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); } catch (_) { return null; }
}

function saveAgentJson(agentId, data) {
    const fpath = path.join(AGENTS_DIR, `${agentId}.json`);
    fs.writeFileSync(fpath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getModelOptions(agentData) {
    return Array.isArray(agentData?.cli?.modelOptions) ? agentData.cli.modelOptions : [];
}

function existingValues(modelOptions) {
    return new Set(modelOptions.map(o => o.value).filter(Boolean));
}

/** Load project config for benchRefresh overrides. */
function loadBenchRefreshConfig(repoPath) {
    const cfgPath = path.join(repoPath, '.aigon', 'config.json');
    if (!fs.existsSync(cfgPath)) return {};
    try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')).benchRefresh || {}; } catch (_) { return {}; }
}

// --- Model discovery ---

/** Get op provider prefixes from existing modelOptions values. */
function getOpProviderPrefixes(modelOptions, configPrefixes) {
    if (configPrefixes && configPrefixes.length > 0) return configPrefixes;
    const prefixSet = new Set();
    for (const opt of modelOptions) {
        if (!opt.value) continue;
        // e.g. "openrouter/deepseek/..." → prefix "openrouter/deepseek"
        const parts = opt.value.split('/');
        if (parts.length >= 2) prefixSet.add(`${parts[0]}/${parts[1]}`);
    }
    return Array.from(prefixSet);
}

async function discoverOpModels(modelOptions, config) {
    const prefixes = getOpProviderPrefixes(modelOptions, config.opProviderPrefixes);
    const existing = existingValues(modelOptions);

    let data;
    try {
        data = await httpsGet('https://openrouter.ai/api/v1/models');
    } catch (err) {
        process.stdout.write(`⚠️  OpenRouter fetch failed: ${err.message}\n`);
        return [];
    }

    const candidates = (data.data || []).filter(m => {
        if (!m.id) return false;
        if (existing.has(m.id)) return false;
        return prefixes.some(pfx => m.id.startsWith(pfx));
    });

    return candidates.map(m => ({
        value: m.id,
        label: m.name || m.id,
        pricing: null,
    }));
}

async function discoverGgModels(modelOptions) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        process.stdout.write(`⚠️  GEMINI_API_KEY not set — skipping Gemini model discovery\n`);
        return [];
    }
    const existing = existingValues(modelOptions);

    let data;
    try {
        data = await httpsGet(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
    } catch (err) {
        process.stdout.write(`⚠️  Gemini API fetch failed: ${err.message}\n`);
        return [];
    }

    const candidates = (data.models || []).filter(m => {
        if (!m.name || !m.name.startsWith('models/gemini-')) return false;
        if (!Array.isArray(m.supportedGenerationMethods) || !m.supportedGenerationMethods.includes('generateContent')) return false;
        const value = m.name.replace(/^models\//, '');
        return !existing.has(value);
    });

    return candidates.map(m => ({
        value: m.name.replace(/^models\//, ''),
        label: m.displayName || m.name.replace(/^models\//, ''),
        pricing: null,
    }));
}

// --- Staleness filtering ---

/**
 * Read all-{seed}-*.json summary files from .aigon/benchmarks/.
 * Returns a map of `${agentId}::${modelValue}` → lastRunMs.
 */
function buildLastRunMap(repoPath) {
    const benchDir = path.join(repoPath, '.aigon', 'benchmarks');
    if (!fs.existsSync(benchDir)) return {};

    const allFiles = fs.readdirSync(benchDir)
        .filter(f => f.startsWith('all-') && f.endsWith('.json'))
        .sort(); // lexicographic = chronological for ISO timestamps

    const lastRun = {};

    for (const fname of allFiles) {
        let data;
        try { data = JSON.parse(fs.readFileSync(path.join(benchDir, fname), 'utf8')); } catch (_) { continue; }
        const ts = data.timestamp ? new Date(data.timestamp).getTime() : 0;
        if (!ts || Number.isNaN(ts)) continue;

        for (const pair of (data.pairs || [])) {
            const key = `${pair.agentId}::${pair.modelValue}`;
            if (!lastRun[key] || ts > lastRun[key]) {
                lastRun[key] = ts;
            }
        }
    }

    return lastRun;
}

/**
 * Compute stale/fresh split for a set of pairs against staleness thresholds.
 *
 * @param {Array<{agentId, modelValue, modelLabel}>} pairs
 * @param {object} lastRunMap  - key `agentId::modelValue` → lastRunMs
 * @param {object} thresholdDays - agentId → days
 * @returns {{ stale: Array, fresh: Array }}
 */
function splitByStale(pairs, lastRunMap, thresholdDays) {
    const now = Date.now();
    const stale = [];
    const fresh = [];

    for (const pair of pairs) {
        const key = `${pair.agentId}::${pair.modelValue}`;
        const lastMs = lastRunMap[key] ?? 0;
        const ageMs = now - lastMs;
        const threshold = (thresholdDays[pair.agentId] ?? DEFAULT_STALENESS_DAYS[pair.agentId] ?? 30) * 86_400_000;
        if (ageMs >= threshold) {
            stale.push({ ...pair, lastRunMs: lastMs, ageMs });
        } else {
            fresh.push({ ...pair, lastRunMs: lastMs, ageMs });
        }
    }

    return { stale, fresh };
}

function fmtAge(ageMs) {
    if (ageMs === 0) return 'never';
    const days = Math.floor(ageMs / 86_400_000);
    if (days > 0) return `${days}d ago`;
    return `${Math.floor(ageMs / 3_600_000)}h ago`;
}

// --- Main command ---

async function benchRefresh(rawArgs) {
    const args = rawArgs || [];
    const isDryRun = args.includes('--dry-run');
    const isForce = args.includes('--force');
    const repoPath = process.cwd();

    // Parse per-agent day flags: --gg-days N, --op-days N, --cc-days N, --cx-days N
    const thresholdDays = { ...DEFAULT_STALENESS_DAYS };
    for (const agentId of ['gg', 'op', 'cc', 'cx']) {
        const flag = `--${agentId}-days`;
        const idx = args.indexOf(flag);
        if (idx !== -1 && args[idx + 1]) {
            const val = parseInt(args[idx + 1], 10);
            if (!Number.isNaN(val) && val > 0) thresholdDays[agentId] = val;
        }
    }

    // Merge config-level threshold overrides
    const benchConfig = loadBenchRefreshConfig(repoPath);
    if (benchConfig.stalenessThresholdDays && typeof benchConfig.stalenessThresholdDays === 'object') {
        Object.assign(thresholdDays, benchConfig.stalenessThresholdDays);
    }
    const autoAddModels = benchConfig.autoAddModels !== false; // default true

    // --- Step 1: Model discovery ---
    process.stdout.write('\n🔍 Discovering new models...\n');

    const ggData = loadAgentJson('gg');
    const opData = loadAgentJson('op');

    const ggOptions = ggData ? getModelOptions(ggData) : [];
    const opOptions = opData ? getModelOptions(opData) : [];

    const [ggNew, opNew] = await Promise.all([
        discoverGgModels(ggOptions),
        discoverOpModels(opOptions, benchConfig),
    ]);

    // Print discovery summary
    if (ggNew.length > 0) {
        process.stdout.write(`\ngg (Gemini) — ${ggNew.length} new model(s):\n`);
        for (const m of ggNew) process.stdout.write(`  + would add: ${m.value}\n`);
    } else {
        process.stdout.write('gg (Gemini) — no new models found\n');
    }
    if (opNew.length > 0) {
        process.stdout.write(`op (OpenRouter) — ${opNew.length} new model(s):\n`);
        for (const m of opNew) process.stdout.write(`  + would add: ${m.value}\n`);
    } else {
        process.stdout.write('op (OpenRouter) — no new models found\n');
    }

    // --- Step 2: Collect all active pairs ---
    const { collectAllPairs } = require('../perf-bench');
    const allPairs = collectAllPairs([]); // all agents, all non-quarantined models

    // --- Step 3: Staleness filtering ---
    const lastRunMap = buildLastRunMap(repoPath);

    let stalePairs, freshPairs;
    if (isForce) {
        stalePairs = allPairs.map(p => ({ ...p, lastRunMs: 0, ageMs: Infinity }));
        freshPairs = [];
    } else {
        ({ stale: stalePairs, fresh: freshPairs } = splitByStale(allPairs, lastRunMap, thresholdDays));
    }

    // --- Dry-run output ---
    if (isDryRun) {
        process.stdout.write('\n');
        process.stdout.write('NEW MODELS (would add)\n');
        process.stdout.write('─'.repeat(60) + '\n');
        if (ggNew.length === 0 && opNew.length === 0) {
            process.stdout.write('  (none)\n');
        } else {
            for (const m of ggNew) process.stdout.write(`  gg  ${m.value}\n`);
            for (const m of opNew) process.stdout.write(`  op  ${m.value}\n`);
        }

        process.stdout.write('\nSTALE PAIRS (would run)\n');
        process.stdout.write('─'.repeat(60) + '\n');
        if (stalePairs.length === 0) {
            process.stdout.write('  (none)\n');
        } else {
            for (const p of stalePairs) {
                process.stdout.write(`  ${p.agentId.padEnd(4)}  ${(p.modelValue || '').slice(0, 48).padEnd(48)}  last: ${fmtAge(p.ageMs)}\n`);
            }
        }

        process.stdout.write('\nFRESH PAIRS (skip)\n');
        process.stdout.write('─'.repeat(60) + '\n');
        if (freshPairs.length === 0) {
            process.stdout.write('  (none)\n');
        } else {
            for (const p of freshPairs) {
                process.stdout.write(`  ${p.agentId.padEnd(4)}  ${(p.modelValue || '').slice(0, 48).padEnd(48)}  last: ${fmtAge(p.ageMs)}\n`);
            }
        }

        process.stdout.write('\n');
        return;
    }

    // --- Step 4: Write new models to agent JSONs ---
    if (autoAddModels) {
        if (ggNew.length > 0 && ggData) {
            for (const m of ggNew) {
                ggData.cli.modelOptions.push(m);
                process.stdout.write(`+ added to gg: ${m.value}\n`);
            }
            saveAgentJson('gg', ggData);
        }
        if (opNew.length > 0 && opData) {
            for (const m of opNew) {
                opData.cli.modelOptions.push(m);
                process.stdout.write(`+ added to op: ${m.value}\n`);
            }
            saveAgentJson('op', opData);
        }
    } else {
        process.stdout.write('ℹ️  autoAddModels disabled in config — skipping model writes\n');
    }

    // --- Step 5: Run stale pairs ---
    if (stalePairs.length === 0) {
        process.stdout.write('\n✅ All pairs are fresh — nothing to run.\n');
        return;
    }

    process.stdout.write(`\n⏱  ${stalePairs.length} stale pair(s) to run:\n`);
    for (const p of stalePairs) {
        process.stdout.write(`   ${p.agentId.padEnd(4)}  ${p.modelValue}  (last: ${fmtAge(p.ageMs)})\n`);
    }

    const { runAllBenchmarks } = require('../perf-bench');

    // Determine seeds: --all-seeds flag or default to brewboard
    const allSeeds = args.includes('--all-seeds');
    const seeds = allSeeds ? ['brewboard', 'brewboard-review'] : ['brewboard'];

    // Determine judge flag
    const useJudge = args.includes('--judge');

    // Determine skip-baseline: skip when all stale pairs belong to a single agent
    const agentIds = [...new Set(stalePairs.map(p => p.agentId))];
    const skipBaseline = agentIds.length === 1;

    // Build a pairFilter set for runAllBenchmarks
    const pairFilterKeys = new Set(stalePairs.map(p => `${p.agentId}::${p.modelValue}`));

    for (const seedName of seeds) {
        process.stdout.write(`\n🌱 Seed: ${seedName}\n`);
        try {
            await runAllBenchmarks({
                seedName,
                repoPath,
                skipBaseline,
                judge: useJudge,
                pairFilter: pairFilterKeys,
                skipQuotaCheck: isForce,
            });
        } catch (err) {
            process.stdout.write(`❌ Seed ${seedName} failed: ${err.message}\n`);
        }
    }
}

function createBenchCommands() {
    return {
        'bench-refresh': (args) => benchRefresh(args),
    };
}

module.exports = {
    createBenchCommands,
    // exported for unit testing
    splitByStale,
    buildLastRunMap,
    discoverGgModels,
    discoverOpModels,
};
