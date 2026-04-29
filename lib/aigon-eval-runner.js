'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { readSignalEvents } = require('./signal-health');
const checks = require('./aigon-eval-checks');

const DEFAULT_RUNS = 3;
const DEFAULT_SLA_SECONDS = 600;
const DEFAULT_WORKLOAD = 'both';
const WORKLOADS_DIR = path.join(__dirname, '..', 'templates', 'aigon-eval', 'workloads');

function timestampSlug(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function safeSlug(value) {
    return String(value || 'default').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function benchmarksDir(repoPath) {
    return path.join(repoPath, '.aigon', 'benchmarks', 'aigon-eval');
}

function loadFixture(workload) {
    const fixturePath = path.join(WORKLOADS_DIR, workload, 'expected.json');
    if (!fs.existsSync(fixturePath)) throw new Error(`Missing aigon-eval workload fixture: ${fixturePath}`);
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function resolveWorkloads(workload = DEFAULT_WORKLOAD) {
    if (!workload || workload === 'both') return ['feature', 'research'];
    if (workload === 'feature' || workload === 'research') return [workload];
    throw new Error(`Invalid --workload ${workload}; expected feature, research, or both`);
}

function runGit(repoPath, args, opts = {}) {
    const result = spawnSync('git', args, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
    }
    return (result.stdout || '').trim();
}

function createEvalWorktree({ repoPath, agent, model, ref = 'HEAD', now = new Date() }) {
    const tmpPath = path.join(os.tmpdir(), `aigon-eval-${safeSlug(agent)}-${safeSlug(model)}-${timestampSlug(now)}`);
    fs.rmSync(tmpPath, { recursive: true, force: true });
    runGit(repoPath, ['worktree', 'add', '--detach', tmpPath, ref]);
    return tmpPath;
}

function removeEvalWorktree(repoPath, worktreePath) {
    if (!worktreePath) return;
    const result = spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        spawnSync('git', ['worktree', 'prune'], { cwd: repoPath, stdio: 'ignore' });
    }
}

function readJsonIfExists(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function readChangedFiles(repoPath, baseRef = 'HEAD') {
    const out = spawnSync('git', ['diff', '--name-only', baseRef], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (out.status !== 0) return [];
    return (out.stdout || '').split('\n').map(line => line.trim()).filter(Boolean);
}

function writeRunResult(repoPath, result) {
    const dir = benchmarksDir(repoPath);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${safeSlug(result.agent)}-${safeSlug(result.model)}-${result.workload}-${timestampSlug(new Date(result.startedAt))}.json`;
    const fullPath = path.join(dir, file);
    fs.writeFileSync(fullPath, JSON.stringify(result, null, 2) + '\n');
    return fullPath;
}

function spawnAigon(args, cwd, timeoutMs) {
    const result = spawnSync('aigon', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
    });
    return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error ? result.error.message : null,
    };
}

async function runSingleEval(options = {}) {
    const repoPath = options.repoPath || process.cwd();
    const agent = options.agent;
    const model = options.model || null;
    const workload = options.workload || 'feature';
    if (!agent) throw new Error('runSingleEval requires an agent');

    const fixture = options.fixture || loadFixture(workload);
    const startedAt = new Date().toISOString();

    if (options.injectedRun) {
        const matrix = checks.runCheckMatrix({
            fixture,
            telemetryEvents: options.injectedRun.telemetryEvents || [],
            finalEngineSnapshot: options.injectedRun.finalEngineSnapshot || {},
            gitDiff: options.injectedRun.gitDiff || {},
            commandEvents: options.injectedRun.commandEvents || [],
            finalSpecPath: options.injectedRun.finalSpecPath,
            slaSeconds: options.slaSeconds || fixture.slaSeconds || DEFAULT_SLA_SECONDS,
        });
        const result = { agent, model, workload, startedAt, finishedAt: new Date().toISOString(), ...matrix };
        result.path = writeRunResult(repoPath, result);
        return result;
    }

    let worktreePath = null;
    try {
        worktreePath = createEvalWorktree({ repoPath, agent, model, ref: options.ref || 'HEAD' });
        const timeoutMs = Number(options.timeoutMs || fixture.timeoutMs || 600000);
        const runArgs = workload === 'research'
            ? ['research-do', fixture.id, '--agent', agent]
            : ['feature-do', fixture.id, '--agent', agent];
        if (model) runArgs.push('--model', model);

        const commandResult = spawnAigon(runArgs, worktreePath, timeoutMs);
        const telemetryEvents = readSignalEvents({
            repoPath: worktreePath,
            since: startedAt,
            agent,
            entityType: workload,
        });
        const finalEngineSnapshot = readJsonIfExists(path.join(worktreePath, '.aigon', 'workflows', workload === 'research' ? 'research' : 'features', fixture.id, 'snapshot.json')) || {};
        const gitDiff = { changedFiles: readChangedFiles(worktreePath, 'HEAD') };
        const commandEvents = [{ command: `aigon ${runArgs.join(' ')}`, result: commandResult.status }];
        const matrix = checks.runCheckMatrix({
            fixture,
            telemetryEvents,
            finalEngineSnapshot,
            gitDiff,
            commandEvents,
            finalSpecPath: fixture.finalSpecPath || null,
            slaSeconds: options.slaSeconds || fixture.slaSeconds || DEFAULT_SLA_SECONDS,
        });
        const result = {
            agent,
            model,
            workload,
            worktreePath,
            startedAt,
            finishedAt: new Date().toISOString(),
            commandResult,
            ...matrix,
        };
        result.path = writeRunResult(repoPath, result);
        return result;
    } finally {
        removeEvalWorktree(repoPath, worktreePath);
    }
}

function aggregateMatrix(repoPath, runResults) {
    const byPair = {};
    runResults.forEach(result => {
        const key = `${result.agent}|${result.model || ''}`;
        if (!byPair[key]) {
            byPair[key] = {
                agent: result.agent,
                model: result.model || null,
                runs: 0,
                passed: 0,
                failed: 0,
                reliability: 0,
                failureCounts: {},
                workloads: {},
            };
        }
        const row = byPair[key];
        row.runs += 1;
        if (result.pass) row.passed += 1;
        else row.failed += 1;
        if (!row.workloads[result.workload]) row.workloads[result.workload] = { runs: 0, passed: 0, failed: 0 };
        row.workloads[result.workload].runs += 1;
        if (result.pass) row.workloads[result.workload].passed += 1;
        else row.workloads[result.workload].failed += 1;
        Object.entries(result.checks || {}).forEach(([name, check]) => {
            if (check && !check.pass) row.failureCounts[name] = (row.failureCounts[name] || 0) + 1;
        });
    });
    Object.values(byPair).forEach(row => {
        row.reliability = row.runs > 0 ? Math.round((row.passed / row.runs) * 1000) / 10 : 0;
    });
    const matrix = { updatedAt: new Date().toISOString(), pairs: Object.values(byPair) };
    const file = path.join(benchmarksDir(repoPath), 'matrix.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(matrix, null, 2) + '\n');
    return matrix;
}

async function runEvaluationMatrix(options = {}) {
    const workloads = resolveWorkloads(options.workload || DEFAULT_WORKLOAD);
    const runs = Math.max(1, parseInt(options.runs || DEFAULT_RUNS, 10));
    const pairs = options.pairs || [{ agent: options.agent, model: options.model || null }];
    const results = [];
    for (const pair of pairs) {
        for (const workload of workloads) {
            for (let i = 0; i < runs; i++) {
                results.push(await runSingleEval({
                    ...options,
                    agent: pair.agent,
                    model: pair.model,
                    workload,
                    injectedRun: options.injectedRuns ? options.injectedRuns.shift() : null,
                }));
            }
        }
    }
    return { results, matrix: aggregateMatrix(options.repoPath || process.cwd(), results) };
}

module.exports = {
    DEFAULT_RUNS,
    DEFAULT_SLA_SECONDS,
    DEFAULT_WORKLOAD,
    WORKLOADS_DIR,
    benchmarksDir,
    loadFixture,
    resolveWorkloads,
    createEvalWorktree,
    removeEvalWorktree,
    runSingleEval,
    runEvaluationMatrix,
    aggregateMatrix,
    writeRunResult,
};
