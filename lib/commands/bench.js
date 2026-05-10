'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const seedReset = require('./setup/seed-reset');

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

// --- bench-snapshot (F504): gold-image tarball lifecycle ----------------

const SEED_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard-seed.git',
    trailhead: 'https://github.com/jayvee/trailhead-seed.git',
};

const WORKING_REPO_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard.git',
    trailhead: 'https://github.com/jayvee/trailhead.git',
};

function fmtBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes >= 1_000_000_000) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
    if (bytes >= 1_000_000) return `${Math.round(bytes / 1_048_576)} MB`;
    if (bytes >= 1_000) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

function fmtAgeDays(ms) {
    const days = Math.floor(ms / 86_400_000);
    if (days >= 1) return `${days}d`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours >= 1) return `${hours}h`;
    return `${Math.floor(ms / 60_000)}m`;
}

function getInstalledAigonVersion() {
    try {
        return require(path.join(__dirname, '..', '..', 'package.json')).version;
    } catch (_) {
        return 'unknown';
    }
}

async function benchSnapshot(rawArgs) {
    const args = rawArgs || [];
    const seedName = args.find(a => !a.startsWith('--'));
    const isStatus = args.includes('--status');

    if (!seedName) {
        console.error('Usage: aigon bench-snapshot <seed> [--status]');
        console.error('\nKnown seeds: ' + Object.keys(SEED_REGISTRY).join(', '));
        process.exitCode = 1;
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(SEED_REGISTRY, seedName)) {
        console.error(`❌ Unknown seed: ${seedName}`);
        console.error(`   Known seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    // --- Status mode: report only ---
    if (isStatus) {
        const tarPath = seedReset.goldImagePath(seedName);
        if (!seedReset.goldImageExists(seedName)) {
            process.stdout.write(`📦 Gold image: ${seedName}\n`);
            process.stdout.write(`   status: ❌ not found\n`);
            process.stdout.write(`   path:   ${tarPath}\n`);
            process.stdout.write(`\n   Run 'aigon bench-snapshot ${seedName}' to create.\n`);
            return;
        }
        const meta = seedReset.readGoldMeta(seedName) || {};
        const stat = fs.statSync(tarPath);
        const ageMs = Date.now() - new Date(meta.createdAt || stat.mtime).getTime();
        const currentVersion = getInstalledAigonVersion();
        const versionMatch = meta.aigonVersion === currentVersion;
        process.stdout.write(`📦 Gold image: ${seedName}\n`);
        process.stdout.write(`   status:  ✅ ready${versionMatch ? '' : '  (⚠️  version mismatch)'}\n`);
        process.stdout.write(`   path:    ${tarPath}\n`);
        process.stdout.write(`   size:    ${fmtBytes(stat.size)}\n`);
        process.stdout.write(`   age:     ${fmtAgeDays(ageMs)} (built ${meta.createdAt || stat.mtime.toISOString()})\n`);
        process.stdout.write(`   aigon:   v${meta.aigonVersion || 'unknown'}${versionMatch ? '' : ` (current: v${currentVersion})`}\n`);
        if (meta.seedUrl) process.stdout.write(`   seed:    ${meta.seedUrl}\n`);
        if (meta.workingRepoUrl) process.stdout.write(`   working: ${meta.workingRepoUrl}\n`);
        return;
    }

    // --- Build mode: run full reset, then snapshot ---
    const repoPath = path.join(process.env.HOME || os.homedir(), 'src', seedName);
    const parentDir = path.dirname(repoPath);

    process.stdout.write(`\n🌱 Step 1/2: Running full seed-reset for ${seedName}...\n`);
    process.stdout.write(`   (this is the slow path — required once per aigon version)\n\n`);
    const reset = spawnSync('aigon', ['seed-reset', seedName, '--force'], {
        stdio: 'inherit',
        env: { ...process.env, AIGON_BENCH_MODE: '1' },
    });
    if (reset.status !== 0) {
        process.stderr.write(`\n❌ seed-reset failed (exit ${reset.status}). Aborting snapshot.\n`);
        process.exitCode = 1;
        return;
    }

    if (!fs.existsSync(repoPath)) {
        process.stderr.write(`\n❌ Expected seed repo at ${repoPath} after reset, but it does not exist.\n`);
        process.exitCode = 1;
        return;
    }

    process.stdout.write(`\n📦 Step 2/2: Tarballing ${repoPath}...\n`);
    const t0 = Date.now();
    const result = seedReset.createGoldImage({
        seedName,
        repoPath,
        parentDir,
        repoName: seedName,
    });
    if (!result.ok) {
        process.stderr.write(`❌ Snapshot failed: ${result.error}\n`);
        process.exitCode = 1;
        return;
    }

    const meta = {
        aigonVersion: getInstalledAigonVersion(),
        createdAt: new Date().toISOString(),
        seedUrl: SEED_REGISTRY[seedName],
        workingRepoUrl: WORKING_REPO_REGISTRY[seedName] || null,
    };
    seedReset.writeGoldMeta(seedName, meta);

    const tarPath = seedReset.goldImagePath(seedName);
    process.stdout.write(`\n✅ Snapshot saved: ${tarPath}\n`);
    process.stdout.write(`   size: ${fmtBytes(result.sizeBytes)}\n`);
    process.stdout.write(`   tar:  ${(result.ms / 1000).toFixed(1)}s\n`);
    process.stdout.write(`   total: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    process.stdout.write(`\nNext benchmark runs will use the fast path automatically.\n`);
}

function createBenchCommands() {
    return {
        'bench-refresh': (args) => benchRefresh(args),
        'bench-snapshot': (args) => benchSnapshot(args),
    };
}

module.exports = {
    createBenchCommands,
    // exported for unit testing
    splitByStale,
    buildLastRunMap,
    discoverGgModels,
    discoverOpModels,
    benchSnapshot,
};
