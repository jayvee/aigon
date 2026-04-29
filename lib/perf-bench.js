'use strict';

/**
 * Agent performance benchmark harness.
 *
 * Measures end-to-end aigon run time on a seed repo and breaks it into phases
 * by reading the workflow event log. Records a "bare baseline" — the same task
 * run via `claude -p` with no aigon scaffolding — so the aigon overhead is
 * surfaced explicitly. Results are written as JSON for CI regression checks.
 *
 * Single run:
 *   aigon perf-bench brewboard cc
 *   aigon perf-bench brewboard cc --model claude-sonnet-4-6
 *   aigon perf-bench brewboard cc --model claude-opus-4-7 --effort high
 *
 * Full matrix sweep (all non-quarantined agents × models, default effort):
 *   aigon perf-bench brewboard --all
 *   aigon perf-bench brewboard --all --agents cc,op
 *
 * Committed JSON runs in .aigon/benchmarks/ become the authoritative shipped
 * reference data for each release — run `aigon perf-bench brewboard --all --judge`
 * before tagging so users receive up-to-date numbers without re-running sweeps.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const { readEvents } = require('./workflow-core/event-store');
const { getEventsPath, getSnapshotPath } = require('./workflow-core/paths');
const { resolveFeatureWorktreePath, detectDefaultBranch } = require('./dashboard-status-helpers');
const featureSpecResolver = require('./feature-spec-resolver');
const telemetry = require('./telemetry');
const benchmarkJudge = require('./benchmark-judge');

const REGRESSION_THRESHOLD_PCT = 20;

const DEFAULT_SEEDS = {
    brewboard: {
        path: () => path.join(os.homedir(), 'src', 'brewboard'),
        featureId: '07',
        featureName: 'add-footer',
        baselinePrompt: 'Add a simple footer with copyright text to app/page.tsx. Just one line, no styling needed.',
    },
    // Review bench: feature 08 is pre-baked into the seed with a working-but-weak
    // rating filter implementation. The reviewer is expected to find these weaknesses:
    //
    //   1. style={{ fontWeight }} mixing inline styles with Tailwind —
    //      should be a conditional className (e.g. font-bold / font-normal)
    //
    //   2. style={{ color: '#78716c' }} hardcoded hex in inline style —
    //      should use a Tailwind class (text-stone-500)
    //
    //   3. `filtered` computed inline on every render without useMemo —
    //      should be useMemo(() => BEERS.filter(...), [minRating])
    //
    //   4. No aria-pressed on filter buttons — buttons acting as toggles
    //      need aria-pressed={minRating === threshold} for accessibility
    //
    //   5. Threshold array [0, 3.5, 4.0, 4.5] as magic literals in JSX —
    //      should be a named constant (e.g. const RATING_THRESHOLDS = [...])
    //
    // Scoring: LLM judge asks which weaknesses were identified. Pass threshold: ≥3/5.
    'brewboard-review': {
        path: () => path.join(os.homedir(), 'src', 'brewboard'),
        featureId: '08',
        featureName: 'rating-filter',
        taskType: 'review',
        plantedWeaknesses: [
            'inline style for fontWeight should be a conditional Tailwind className (font-bold/font-normal)',
            'inline style with hardcoded hex color #78716c should be a Tailwind class (text-stone-500)',
            'filtered array is recomputed on every render; should use useMemo',
            'filter buttons have no aria-pressed attribute for accessibility',
            'rating threshold array is magic literals inline in JSX; should be a named constant',
        ],
        judgePassThreshold: 3,
    },
};

function nowMs() {
    return Date.now();
}

function resolveSeed(seedName) {
    const seed = DEFAULT_SEEDS[seedName];
    if (!seed) {
        throw new Error(`Unknown seed: ${seedName}. Known: ${Object.keys(DEFAULT_SEEDS).join(', ')}`);
    }
    const seedPath = seed.path();
    if (!fs.existsSync(seedPath)) {
        throw new Error(`Seed repo not found at ${seedPath}. Run 'aigon seed-reset ${seedName}' first.`);
    }
    return { ...seed, seedPath };
}

function runShell(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, {
        stdio: opts.stdio || 'inherit',
        cwd: opts.cwd || process.cwd(),
        env: opts.env || process.env,
        timeout: opts.timeout || 600_000,
    });
    if (result.error) {
        const code = result.error.code;
        if (code === 'EAGAIN' || code === 'EMFILE') {
            const enriched = new Error(
                `Cannot fork \`${cmd}\`: system at process/fd limit (${code}).\n` +
                'Run `aigon doctor --reap-orphans` to clean up orphaned agent processes, then retry.'
            );
            enriched.code = code;
            throw enriched;
        }
        throw result.error;
    }
    return result;
}

function runShellCapture(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        cwd: opts.cwd || process.cwd(),
        env: opts.env || process.env,
        timeout: opts.timeout || 60_000,
    });
    if (result.error) {
        const code = result.error.code;
        if (code === 'EAGAIN' || code === 'EMFILE') {
            const enriched = new Error(
                `Cannot fork \`${cmd}\`: system at process/fd limit (${code}).\n` +
                'Run `aigon doctor --reap-orphans` to clean up orphaned agent processes, then retry.'
            );
            enriched.code = code;
            throw enriched;
        }
        return null;
    }
    if (result.status !== 0) return null;
    return (result.stdout || '').trim();
}

/**
 * Run a bare `claude -p` baseline on the seed repo.
 * Times one invocation against the same trivial task aigon will run.
 * Returns { ms, ok, stdoutLen } so callers can decide whether to trust the number.
 */
async function runBaseline({ seedPath, baselinePrompt, agentBinary = 'claude', timeoutMs = 300_000 }) {
    const which = spawnSync('which', [agentBinary], { encoding: 'utf8' });
    if (which.status !== 0) {
        return { ok: false, ms: null, reason: `${agentBinary} not on PATH; skipping baseline` };
    }
    const t0 = nowMs();
    return await new Promise((resolve) => {
        const child = spawn(agentBinary, ['-p', baselinePrompt], {
            cwd: seedPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        const killer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
        child.on('close', (code) => {
            clearTimeout(killer);
            const ms = nowMs() - t0;
            resolve({
                ok: code === 0,
                ms,
                stdoutLen: stdout.length,
                stderrTail: stderr.slice(-500),
                exitCode: code,
            });
        });
        child.on('error', (err) => {
            clearTimeout(killer);
            resolve({ ok: false, ms: null, reason: err.message });
        });
    });
}

/**
 * Poll the workflow snapshot until the named agent reaches the target status,
 * or the deadline passes. Returns true on success, false on timeout.
 */
async function waitForAgentStatus({ snapshotPath, agentId, targetStatus, timeoutMs, pollMs = 1000 }) {
    const deadline = nowMs() + timeoutMs;
    while (nowMs() < deadline) {
        if (fs.existsSync(snapshotPath)) {
            try {
                const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
                const agents = snap?.agents || {};
                const agent = agents[agentId];
                if (agent && agent.status === targetStatus) return true;
                if (targetStatus === 'submitted' && agent && (agent.status === 'ready' || agent.status === 'submitted')) return true;
            } catch (_) { /* mid-write */ }
        }
        await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
}

/**
 * Compute phase durations from a workflow events.jsonl file.
 * Phases:
 *   cli-start: t0 → feature.started
 *   agent-boot: feature.started → first signal.heartbeat or signal.agent_started
 *   agent-work: first heartbeat → signal.agent_submitted
 *   agent-signal: signal.agent_submitted → end (≈0; recorded for completeness)
 */
async function extractPhases({ eventsPath, t0Ms, tEndMs }) {
    const events = await readEvents(eventsPath);
    const at = (type) => {
        const e = events.find(ev => ev.type === type);
        return e ? new Date(e.at).getTime() : null;
    };
    const featureStarted = at('feature.started');
    const agentStarted = at('signal.agent_started');
    const firstHeartbeat = (events.find(ev => ev.type === 'signal.heartbeat')?.at);
    const heartbeatMs = firstHeartbeat ? new Date(firstHeartbeat).getTime() : null;
    const agentSubmitted = at('signal.agent_submitted');

    const bootMark = heartbeatMs || agentStarted;
    const workEndMark = agentSubmitted;

    const phases = [];
    if (featureStarted != null) {
        phases.push({ name: 'cli-start', ms: featureStarted - t0Ms });
    }
    if (featureStarted != null && bootMark != null) {
        phases.push({ name: 'agent-boot', ms: bootMark - featureStarted });
    }
    if (bootMark != null && workEndMark != null) {
        phases.push({ name: 'agent-work', ms: workEndMark - bootMark });
    }
    if (workEndMark != null && tEndMs != null) {
        phases.push({ name: 'agent-signal', ms: Math.max(0, tEndMs - workEndMark) });
    }
    return phases;
}

function getAigonVersion() {
    try {
        return require(path.join(__dirname, '..', 'package.json')).version;
    } catch (_) {
        return 'unknown';
    }
}

function getBenchmarksDir(repoPath) {
    return path.join(repoPath, '.aigon', 'benchmarks');
}

function writeResult(repoPath, result) {
    const dir = getBenchmarksDir(repoPath);
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = `${result.seed}-${result.featureId}-${ts}.json`;
    const fpath = path.join(dir, fname);
    fs.writeFileSync(fpath, JSON.stringify(result, null, 2) + '\n', 'utf8');
    return fpath;
}

function loadBaselineFile(repoPath) {
    const fpath = path.join(getBenchmarksDir(repoPath), 'baseline.json');
    if (!fs.existsSync(fpath)) return null;
    try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); } catch (_) { return null; }
}

function saveBaselineFile(repoPath, baseline) {
    const dir = getBenchmarksDir(repoPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf8');
}

/**
 * Compare current totalMs against stored baseline.
 * Returns { regressed, deltaPct, baseline }.
 */
function compareToBaseline(repoPath, current) {
    const stored = loadBaselineFile(repoPath);
    if (!stored || stored.totalMs == null) return { regressed: false, deltaPct: null, baseline: null };
    const deltaPct = ((current.totalMs - stored.totalMs) / stored.totalMs) * 100;
    return {
        regressed: deltaPct > REGRESSION_THRESHOLD_PCT,
        deltaPct,
        baseline: stored,
    };
}

/**
 * Collect all (agentId, modelValue, modelLabel) pairs across all configured agents.
 * Skips quarantined, archived, and null-value models.
 * @param {string[]} [filterAgents] - if non-empty, only include these agent IDs
 */
function collectAllPairs(filterAgents = []) {
    const agentRegistry = require('./agent-registry');
    const agents = agentRegistry.getAllAgents();
    const pairs = [];
    for (const agent of agents) {
        if (filterAgents.length > 0 && !filterAgents.includes(agent.id)) continue;
        const opts = Array.isArray(agent.cli && agent.cli.modelOptions) ? agent.cli.modelOptions : [];
        const active = opts.filter(o => o.value && !o.quarantined && !o.archived);
        for (const opt of active) {
            pairs.push({ agentId: agent.id, modelValue: opt.value, modelLabel: opt.label || opt.value });
        }
    }
    return pairs;
}

function fmtMs(ms) {
    if (ms == null) return '—';
    if (ms >= 60_000) return `${Math.round(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function readBenchmarkTelemetryUsage({ repoPath, featureId, agentId }) {
    const telemetryDir = path.join(repoPath, '.aigon', 'telemetry');
    if (!fs.existsSync(telemetryDir)) return null;

    let files = [];
    try {
        files = fs.readdirSync(telemetryDir)
            .filter((f) => f.startsWith(`feature-${featureId}-`) && (f.endsWith('.json') || f.endsWith('.json.gz')));
    } catch (_) {
        return null;
    }
    if (files.length === 0) return null;

    const totals = {
        inputTokens: 0,
        cachedInputTokens: 0,
        freshInputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        billableTokens: 0,
        sessions: 0,
        costUsd: 0,
        model: null,
    };
    const seenModels = new Set();

    for (const file of files) {
        try {
            const data = JSON.parse(telemetry.readTelemetryFile(path.join(telemetryDir, file)));
            if (agentId && String(data.agent || '').toLowerCase() !== String(agentId).toLowerCase()) continue;
            const usage = data.tokenUsage || {};
            const input = Number(usage.input || 0);
            const cachedInput = Number(usage.cacheReadInput || 0);
            const output = Number(usage.output || 0);
            const thinking = Number(usage.thinking || 0);
            const total = Number(usage.total || 0);
            const billable = Number(usage.billable || 0);
            totals.inputTokens += input;
            totals.cachedInputTokens += cachedInput;
            totals.outputTokens += output;
            totals.thinkingTokens += thinking;
            totals.totalTokens += total || (input + cachedInput + output + thinking);
            totals.billableTokens += billable || (input + output + thinking);
            totals.costUsd += Number(data.costUsd || 0);
            totals.sessions += 1;
            if (data.model) seenModels.add(String(data.model));
        } catch (_) {
            // Skip malformed telemetry snapshots; benchmark timing remains usable.
        }
    }

    if (totals.sessions === 0) return null;
    totals.freshInputTokens = Math.max(0, totals.inputTokens - totals.cachedInputTokens);
    totals.costUsd = Math.round(totals.costUsd * 10000) / 10000;
    totals.model = seenModels.size > 0 ? Array.from(seenModels).join(', ') : null;
    return totals;
}

async function waitForBenchmarkTelemetryUsage({ repoPath, featureId, agentId, timeoutMs = 15000, pollMs = 1000 }) {
    const deadline = nowMs() + timeoutMs;
    while (nowMs() < deadline) {
        const usage = readBenchmarkTelemetryUsage({ repoPath, featureId, agentId });
        if (usage) return usage;
        await new Promise(r => setTimeout(r, pollMs));
    }
    return null;
}

function normalizeCapturedTelemetryUsage(data) {
    if (!data || typeof data !== 'object') return null;
    const cachedInputTokens = Number(data.cache_read_input_tokens || 0);
    const rawInputTokens = Number(data.input_tokens || 0);
    const inputTokens = cachedInputTokens > 0 && rawInputTokens < cachedInputTokens
        ? rawInputTokens + cachedInputTokens
        : rawInputTokens;
    const outputTokens = Number(data.output_tokens || 0);
    const thinkingTokens = Number(data.thinking_tokens || 0);
    const totalTokens = Number(data.total_tokens || 0);
    const billableTokens = inputTokens + outputTokens + thinkingTokens;
    const sessions = Number(data.sessions || 0);
    const costUsd = Number(data.cost_usd || 0);
    const model = data.model != null ? String(data.model) : null;
    if (sessions <= 0 && inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) return null;
    return {
        inputTokens,
        cachedInputTokens,
        freshInputTokens: Math.max(0, inputTokens - cachedInputTokens),
        outputTokens,
        thinkingTokens,
        totalTokens,
        billableTokens,
        sessions,
        costUsd: Math.round(costUsd * 10000) / 10000,
        model,
    };
}

function prepareSeedFixture(seed) {
    if ((seed.taskType || 'do') !== 'do') return;
    process.stdout.write(`🧰 Re-arming benchmark fixture feature ${seed.featureId}...\n`);
    const reset = runShell('aigon', ['feature-reset', seed.featureId], {
        cwd: seed.seedPath,
        stdio: 'inherit',
    });
    if (reset.status !== 0) {
        throw new Error(`feature-reset ${seed.featureId} failed (exit ${reset.status})`);
    }
}

function collectImplementationArtifact({ seedPath, featureId, agentId }) {
    const worktreeBaseDir = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(seedPath));
    const worktreePath = resolveFeatureWorktreePath(worktreeBaseDir, featureId, agentId);
    if (!worktreePath || !fs.existsSync(worktreePath)) return null;

    const defaultBranch = detectDefaultBranch(worktreePath) || 'main';
    const changedFilesRaw = runShellCapture('git', ['-C', worktreePath, 'diff', '--name-only', `${defaultBranch}..HEAD`]);
    const changedFiles = changedFilesRaw ? changedFilesRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const diffStat = runShellCapture('git', ['-C', worktreePath, 'diff', '--stat', `${defaultBranch}..HEAD`]) || '';
    const diffText = runShellCapture('git', ['-C', worktreePath, 'diff', '--unified=3', `${defaultBranch}..HEAD`]) || '';

    const spec = featureSpecResolver.resolveFeatureSpec(seedPath, featureId);
    let specBody = '';
    if (spec && spec.path && fs.existsSync(spec.path)) {
        try {
            specBody = fs.readFileSync(spec.path, 'utf8');
        } catch (_) {
            specBody = '';
        }
    }

    return {
        worktreePath,
        defaultBranch,
        changedFiles,
        diffStat,
        diffText: diffText.slice(0, 20000),
        specPath: spec && spec.path ? spec.path : null,
        specBody: specBody.slice(0, 12000),
    };
}

/**
 * Drive a single benchmark run end-to-end.
 *
 * Steps: seed-reset → bare baseline (claude -p) → feature-start → poll until
 * implementation-complete → read events → write JSON result.
 *
 * @param {object} opts
 * @param {string} opts.seedName        - "brewboard" etc.
 * @param {string} [opts.agent]         - agent ID, default "cc"
 * @param {string} [opts.model]         - model value to pass as --models <agent>=<model>
 * @param {string} [opts.effort]        - effort level to pass as --efforts <agent>=<effort>
 * @param {string} [opts.repoPath]      - main aigon repo path (where results are written)
 * @param {boolean} [opts.skipBaseline]
 * @param {number} [opts.timeoutMs]     - poll timeout in ms
 * @param {boolean} [opts.dryRun]
 */
async function runBenchmark(opts = {}) {
    const seedName = opts.seedName || 'brewboard';
    const agent = opts.agent || 'cc';
    const model = opts.model || null;
    const effort = opts.effort || null;
    const repoPath = opts.repoPath || process.cwd();
    const timeoutMs = opts.timeoutMs || 600_000;

    const seed = resolveSeed(seedName);

    const modelLabel = model ? ` --model ${model}` : '';
    const effortLabel = effort ? ` --effort ${effort}` : '';

    if (opts.dryRun) {
        const featureStartArgs = ['feature-start', seed.featureId, agent, '--background'];
        if (model) featureStartArgs.push('--models', `${agent}=${model}`);
        if (effort) featureStartArgs.push('--efforts', `${agent}=${effort}`);
        return {
            dryRun: true,
            plan: {
                seedReset: `aigon seed-reset ${seedName}`,
                baseline: `claude -p "${seed.baselinePrompt}" (cwd=${seed.seedPath})`,
                featureStart: `aigon ${featureStartArgs.join(' ')}`,
                pollUntil: `implementation-complete for agent ${agent}`,
                writeResult: path.join(getBenchmarksDir(repoPath), `${seedName}-${seed.featureId}-<ts>.json`),
            },
        };
    }

    process.stdout.write(`\n${'─'.repeat(72)}\n`);
    process.stdout.write(`▶ ${agent}${modelLabel}${effortLabel}\n`);
    process.stdout.write(`${'─'.repeat(72)}\n`);

    process.stdout.write(`🌱 Resetting seed ${seedName}...\n`);
    const reset = runShell('aigon', ['seed-reset', seedName, '--force'], { stdio: 'inherit' });
    if (reset.status !== 0) throw new Error(`seed-reset failed (exit ${reset.status})`);
    prepareSeedFixture(seed);

    let baseline = null;
    if (!opts.skipBaseline) {
        process.stdout.write(`⏱  Bare baseline (claude -p) on ${seed.seedPath}...\n`);
        baseline = await runBaseline({ seedPath: seed.seedPath, baselinePrompt: seed.baselinePrompt });
        if (baseline.ok) {
            process.stdout.write(`   baseline: ${fmtMs(baseline.ms)}\n`);
        } else {
            process.stdout.write(`   baseline skipped: ${baseline.reason || `exit ${baseline.exitCode}`}\n`);
        }
        runShell('aigon', ['seed-reset', seedName, '--force'], { stdio: 'inherit' });
        prepareSeedFixture(seed);
    }

    const featureStartArgs = ['feature-start', seed.featureId, agent, '--background'];
    if (model) featureStartArgs.push('--models', `${agent}=${model}`);
    if (effort) featureStartArgs.push('--efforts', `${agent}=${effort}`);

    const t0 = nowMs();
    process.stdout.write(`🚀 aigon ${featureStartArgs.join(' ')}\n`);
    const start = runShell('aigon', featureStartArgs, {
        cwd: seed.seedPath,
        stdio: 'inherit',
    });
    if (start.status !== 0) throw new Error(`feature-start failed (exit ${start.status})`);

    const snapshotPath = getSnapshotPath(seed.seedPath, seed.featureId);
    const eventsPath = getEventsPath(seed.seedPath, seed.featureId);

    process.stdout.write(`⏳ Waiting for ${agent} to reach implementation-complete (timeout ${Math.round(timeoutMs / 60_000)}m)...\n`);
    const ok = await waitForAgentStatus({
        snapshotPath,
        agentId: agent,
        targetStatus: 'ready',  // snapshot sets agent.status='ready' when implementation-complete fires
        timeoutMs,
    });
    const tEnd = nowMs();
    if (!ok) {
        throw new Error(`Timed out waiting for ${agent} to signal implementation-complete`);
    }

    const totalMs = tEnd - t0;
    const phases = await extractPhases({ eventsPath, t0Ms: t0, tEndMs: tEnd });
    const baselineMs = baseline && baseline.ok ? baseline.ms : null;
    const overheadMs = baselineMs != null ? totalMs - baselineMs : null;
    const implementationArtifact = collectImplementationArtifact({
        seedPath: seed.seedPath,
        featureId: seed.featureId,
        agentId: agent,
    });
    let tokenUsage = normalizeCapturedTelemetryUsage(telemetry.captureAgentTelemetry(
        seed.featureId,
        seed.featureName || `feature-${seed.featureId}`,
        agent,
        {
            repoPath: seed.seedPath,
            worktreePath: implementationArtifact && implementationArtifact.worktreePath
                ? implementationArtifact.worktreePath
                : undefined,
            afterMs: t0 - 3000,
        }
    ));
    if (!tokenUsage) {
        tokenUsage = await waitForBenchmarkTelemetryUsage({
            repoPath: seed.seedPath,
            featureId: seed.featureId,
            agentId: agent,
        });
    }

    const result = {
        seed: seedName,
        featureId: seed.featureId,
        taskType: 'do',
        agent,
        model: model || null,
        effort: effort || null,
        aigonVersion: getAigonVersion(),
        timestamp: new Date(t0).toISOString(),
        totalMs,
        baselineMs,
        overheadMs,
        phases,
        tokenUsage,
        implementationArtifact,
        ok: true,
    };

    let fpath = writeResult(repoPath, result);
    process.stdout.write(`✅ ${fmtMs(totalMs)} total${overheadMs != null ? ` (${fmtMs(overheadMs)} aigon overhead)` : ''}\n`);
    process.stdout.write(`📝 ${path.relative(repoPath, fpath)}\n`);

    let finalResult = result;
    if (opts.judge && result.implementationArtifact) {
        try {
            process.stdout.write(`⚖️  Judging implementation...\n`);
            const enriched = await benchmarkJudge.runImplementationJudge(result, {
                agentBinary: opts.judgeBinary,
                agentId: opts.judgeAgentId,
                model: opts.judgeModel,
                timeoutMs: opts.judgeTimeoutMs,
            });
            finalResult = enriched;
            fs.writeFileSync(fpath, JSON.stringify(enriched, null, 2) + '\n', 'utf8');
            const q = enriched.quality || {};
            process.stdout.write(`   quality: ${q.score != null ? q.score.toFixed(2) : '—'} / 10  (rubric ${q.rubricId})\n`);
        } catch (err) {
            process.stdout.write(`⚠️  Judge failed: ${err.message}\n`);
        }
    } else if (opts.judge && !result.implementationArtifact) {
        process.stdout.write(`⚠️  Judge skipped: no implementation artifact captured\n`);
    }
    return finalResult;
}

/**
 * Run the full matrix: every non-quarantined (agent, model) pair, default effort.
 * Resets seed between each run. Writes individual result files plus a summary.
 *
 * @param {object} opts
 * @param {string} opts.seedName
 * @param {string[]} [opts.agents]    - filter to specific agent IDs
 * @param {string} [opts.repoPath]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.skipBaseline]
 * @param {boolean} [opts.dryRun]
 */
async function runAllBenchmarks(opts = {}) {
    let pairs = collectAllPairs(opts.agents || []);
    if (pairs.length === 0) {
        throw new Error('No active (agent, model) pairs found. Check agent configs for quarantine/archived status.');
    }
    if (!opts.skipQuotaCheck) {
        const quotaProbe = require('./quota-probe');
        const before = pairs.length;
        pairs = pairs.filter(pair => !quotaProbe.isPairDepleted(opts.repoPath || process.cwd(), pair.agentId, pair.modelValue));
        const skipped = before - pairs.length;
        if (skipped > 0) process.stdout.write(`Quota: skipped ${skipped} depleted pair${skipped === 1 ? '' : 's'} (use --skip-quota-check to include)\n`);
        if (pairs.length === 0) {
            throw new Error('All active (agent, model) pairs are depleted. Use --skip-quota-check to override.');
        }
    }

    process.stdout.write(`\nMatrix: ${pairs.length} pairs\n`);
    pairs.forEach((p, i) => process.stdout.write(`  ${i + 1}. ${p.agentId}  ${p.modelLabel}\n`));
    const estMin = pairs.length * 15;
    process.stdout.write(`Estimated time: ${Math.round(estMin / 60)}h ${estMin % 60}m (15m avg per pair)\n\n`);

    if (opts.dryRun) {
        return { dryRun: true, pairs };
    }

    const results = [];
    let passed = 0;
    let failed = 0;

    for (const pair of pairs) {
        try {
            const result = await runBenchmark({
                ...opts,
                agent: pair.agentId,
                model: pair.modelValue,
                effort: null, // default effort for --all
                skipBaseline: opts.skipBaseline !== false, // skip baseline in sweeps to save time
            });
            results.push({ ...pair, ok: true, totalMs: result.totalMs, fpath: result.fpath });
            passed++;
        } catch (err) {
            process.stdout.write(`❌ ${pair.agentId} / ${pair.modelLabel}: ${err.message}\n`);
            results.push({ ...pair, ok: false, error: err.message });
            failed++;
        }
    }

    // Summary table
    process.stdout.write(`\n${'═'.repeat(72)}\n`);
    process.stdout.write(`SUMMARY  ${passed} passed  ${failed} failed\n`);
    process.stdout.write(`${'═'.repeat(72)}\n`);
    for (const r of results) {
        const status = r.ok ? `✅ ${fmtMs(r.totalMs)}` : `❌ ${r.error || 'failed'}`;
        process.stdout.write(`  ${r.agentId.padEnd(4)}  ${(r.modelLabel || r.modelValue || '').slice(0, 44).padEnd(44)}  ${status}\n`);
    }

    // Write a combined summary JSON
    const summaryPath = path.join(getBenchmarksDir(opts.repoPath || process.cwd()),
        `all-${opts.seedName || 'brewboard'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify({ pairs: results, timestamp: new Date().toISOString() }, null, 2));
    process.stdout.write(`\n📝 Summary: ${path.relative(opts.repoPath || process.cwd(), summaryPath)}\n`);

    return { pairs: results, passed, failed };
}

module.exports = {
    runBenchmark,
    runAllBenchmarks,
    collectAllPairs,
    runBaseline,
    extractPhases,
    readBenchmarkTelemetryUsage,
    normalizeCapturedTelemetryUsage,
    waitForBenchmarkTelemetryUsage,
    waitForAgentStatus,
    writeResult,
    loadBaselineFile,
    saveBaselineFile,
    compareToBaseline,
    getBenchmarksDir,
    REGRESSION_THRESHOLD_PCT,
    DEFAULT_SEEDS,
};
