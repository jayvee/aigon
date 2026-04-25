'use strict';

/**
 * Agent performance benchmark harness.
 *
 * Measures end-to-end aigon run time on a seed repo and breaks it into phases
 * by reading the workflow event log. Records a "bare baseline" — the same task
 * run via `claude -p` with no aigon scaffolding — so the aigon overhead is
 * surfaced explicitly. Results are written as JSON for CI regression checks.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const { readEvents } = require('./workflow-core/event-store');
const { getEventsPath, getSnapshotPath } = require('./workflow-core/paths');

const REGRESSION_THRESHOLD_PCT = 20;

const DEFAULT_SEEDS = {
    brewboard: {
        path: () => path.join(os.homedir(), 'src', 'brewboard'),
        featureId: '07',
        featureName: 'add-footer',
        baselinePrompt: 'Add a simple footer with copyright text to app/page.tsx. Just one line, no styling needed.',
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
    if (result.error) throw result.error;
    return result;
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
 * Drive a single benchmark run end-to-end.
 *
 * Steps: seed-reset → bare baseline (claude -p) → feature-start → poll until
 * submitted → read events → write JSON result.
 *
 * @param {object} opts
 * @param {string} opts.seedName - "brewboard" etc.
 * @param {string} [opts.agent] - default "cc"
 * @param {string} [opts.repoPath] - main aigon repo path (where CLI runs)
 * @param {boolean} [opts.skipBaseline]
 * @param {number} [opts.timeoutMs] - submitted-poll timeout
 * @param {boolean} [opts.dryRun]
 */
async function runBenchmark(opts = {}) {
    const seedName = opts.seedName || 'brewboard';
    const agent = opts.agent || 'cc';
    const repoPath = opts.repoPath || process.cwd();
    const timeoutMs = opts.timeoutMs || 600_000;

    const seed = resolveSeed(seedName);

    if (opts.dryRun) {
        return {
            dryRun: true,
            plan: {
                seedReset: `aigon seed-reset ${seedName}`,
                baseline: `claude -p "${seed.baselinePrompt}" (cwd=${seed.seedPath})`,
                featureStart: `aigon feature-start ${seed.featureId} ${agent}`,
                pollUntil: `agents.${agent}.status === "submitted"`,
                writeResult: path.join(getBenchmarksDir(repoPath), `${seedName}-${seed.featureId}-<ts>.json`),
            },
        };
    }

    process.stdout.write(`🌱 Resetting seed ${seedName}...\n`);
    const reset = runShell('aigon', ['seed-reset', seedName, '--force'], { stdio: 'inherit' });
    if (reset.status !== 0) throw new Error(`seed-reset failed (exit ${reset.status})`);

    let baseline = null;
    if (!opts.skipBaseline) {
        process.stdout.write(`⏱  Bare baseline (claude -p) on ${seed.seedPath}...\n`);
        baseline = await runBaseline({ seedPath: seed.seedPath, baselinePrompt: seed.baselinePrompt });
        if (baseline.ok) {
            process.stdout.write(`   baseline: ${baseline.ms}ms\n`);
        } else {
            process.stdout.write(`   baseline skipped: ${baseline.reason || `exit ${baseline.exitCode}`}\n`);
        }
        // Reset again so the baseline edits don't pollute the aigon run.
        runShell('aigon', ['seed-reset', seedName, '--force'], { stdio: 'inherit' });
    }

    const t0 = nowMs();
    process.stdout.write(`🚀 Starting feature ${seed.featureId} with ${agent}...\n`);
    // feature-start runs from inside the seed repo (the seed has its own .aigon).
    const start = runShell('aigon', ['feature-start', seed.featureId, agent], {
        cwd: seed.seedPath,
        stdio: 'inherit',
    });
    if (start.status !== 0) throw new Error(`feature-start failed (exit ${start.status})`);

    const snapshotPath = getSnapshotPath(seed.seedPath, seed.featureId);
    const eventsPath = getEventsPath(seed.seedPath, seed.featureId);

    process.stdout.write(`⏳ Waiting for ${agent} to submit (timeout ${Math.round(timeoutMs / 1000)}s)...\n`);
    const ok = await waitForAgentStatus({ snapshotPath, agentId: agent, targetStatus: 'submitted', timeoutMs });
    const tEnd = nowMs();
    if (!ok) {
        throw new Error(`Timed out waiting for ${agent} to submit`);
    }

    const totalMs = tEnd - t0;
    const phases = await extractPhases({ eventsPath, t0Ms: t0, tEndMs: tEnd });
    const baselineMs = baseline && baseline.ok ? baseline.ms : null;
    const overheadMs = baselineMs != null ? totalMs - baselineMs : null;

    const result = {
        seed: seedName,
        featureId: seed.featureId,
        agent,
        model: process.env.AIGON_BENCH_MODEL || null,
        aigonVersion: getAigonVersion(),
        timestamp: new Date(t0).toISOString(),
        totalMs,
        baselineMs,
        overheadMs,
        phases,
        ok: true,
    };

    const fpath = writeResult(repoPath, result);
    process.stdout.write(`📝 Wrote ${path.relative(repoPath, fpath)}\n`);
    return result;
}

module.exports = {
    runBenchmark,
    runBaseline,
    extractPhases,
    waitForAgentStatus,
    writeResult,
    loadBaselineFile,
    saveBaselineFile,
    compareToBaseline,
    getBenchmarksDir,
    REGRESSION_THRESHOLD_PCT,
    DEFAULT_SEEDS,
};
