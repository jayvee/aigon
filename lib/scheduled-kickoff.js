'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const agentRegistry = require('./agent-registry');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { validateFeatureAutonomousPayload, buildFeatureAutonomousCliArgv } = require('./feature-autonomous-payload');
const { readConductorReposFromGlobalConfig } = require('./config');

const STORE_VERSION = 1;
const DEFAULT_POLL_MS = 45 * 1000;
const TRUNCATE_ERR = 4000;

function getStorePath(repoPath) {
    return path.join(repoPath, '.aigon', 'state', 'scheduled-kickoffs.json');
}

function getLockPath(repoPath) {
    return path.join(repoPath, '.aigon', 'state', 'scheduled-kickoffs.json.lock');
}

function sleepSync(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
}

function withStoreLockSync(repoPath, work) {
    const lockPath = getLockPath(repoPath);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const deadline = Date.now() + 8000;
    let handle;
    while (Date.now() < deadline) {
        try {
            handle = fs.openSync(lockPath, 'wx');
            break;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            sleepSync(5);
        }
    }
    if (!handle) throw new Error('scheduled-kickoffs: lock timeout');
    try {
        return work();
    } finally {
        try { fs.closeSync(handle); } catch (_) { /* ignore */ }
        try { fs.rmSync(lockPath, { force: true }); } catch (_) { /* ignore */ }
    }
}

function atomicWriteJson(filePath, data) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

function readStoreUnlocked(repoPath) {
    const p = getStorePath(repoPath);
    if (!fs.existsSync(p)) {
        return { version: STORE_VERSION, jobs: [] };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
        return { version: STORE_VERSION, jobs };
    } catch (_) {
        return { version: STORE_VERSION, jobs: [] };
    }
}

function writeStoreUnlocked(repoPath, store) {
    atomicWriteJson(getStorePath(repoPath), store);
}

function newJobId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeRepoPath(p) {
    return path.resolve(String(p || '').trim());
}

/** runAt must parse and include Z or ±offset (no naive local strings). */
function parseRunAt(runAtRaw) {
    const s = String(runAtRaw || '').trim();
    if (!s) return { ok: false, error: 'runAt is required' };
    if (!/T/i.test(s)) return { ok: false, error: 'runAt must be an ISO 8601 datetime (include T and timezone)' };
    const hasZone = /z$/i.test(s)
        || /[+-]\d{2}:\d{2}/.test(s)
        || /[+-]\d{2}:\d{2}:\d{2}/.test(s)
        || /[+-]\d{4}\s*$/.test(s);
    if (!hasZone) {
        return { ok: false, error: 'runAt must include a timezone (e.g. ...Z or ...-07:00 or ...+0530)' };
    }
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) return { ok: false, error: 'runAt is not a valid ISO 8601 datetime' };
    return { ok: true, ms, iso: s };
}

function validateResearchStartPayload(payload, registry) {
    const agents = Array.isArray(payload.agents) ? payload.agents.map(v => String(v || '').trim()).filter(Boolean) : [];
    const bg = Boolean(payload.background);
    const fg = Boolean(payload.foreground);
    if (bg && fg) return { ok: false, error: 'Use either background or foreground, not both' };
    const available = new Set(registry.getAllAgentIds());
    const unknown = agents.filter(a => !available.has(a));
    if (unknown.length > 0) return { ok: false, error: `Unknown agent(s): ${unknown.join(', ')}` };
    return { ok: true, normalized: { agents, background: bg, foreground: fg } };
}

function buildResearchStartArgv(entityId, normalized) {
    const args = ['research-start', entityId];
    args.push(...normalized.agents);
    if (normalized.background) args.push('--background');
    if (normalized.foreground) args.push('--foreground');
    return args;
}

function assertEntitySchedulable(repoPath, kind, entityId) {
    const id = String(entityId).trim();
    if (kind === 'feature_autonomous') {
        const found = featureSpecResolver.listVisibleFeatureSpecs(repoPath, id);
        const inShape = found.some(m => m.stage === 'backlog' || m.stage === 'in-progress');
        if (!inShape) {
            return { ok: false, error: `Feature ${id} not found in backlog or in-progress for this repo` };
        }
        const snap = workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, id);
        if (!snap) {
            return { ok: false, error: `Feature ${id} has no workflow snapshot — run aigon doctor --fix` };
        }
        return { ok: true };
    }
    if (kind === 'research_start') {
        const spec = featureSpecResolver.resolveResearchSpec(repoPath, id);
        if (!spec || !spec.path) {
            return { ok: false, error: `Research ${id} not found in this repo` };
        }
        const stage = spec.stage || '';
        if (stage !== 'backlog' && stage !== 'in-progress') {
            return { ok: false, error: `Research ${id} must be in backlog or in-progress (found stage: ${stage || 'unknown'})` };
        }
        if (stage === 'in-progress') {
            const snap = workflowSnapshotAdapter.readWorkflowSnapshotSync(repoPath, 'research', id);
            if (!snap) {
                return { ok: false, error: `Research ${id} is in-progress but has no workflow snapshot — run aigon doctor --fix` };
            }
        }
        return { ok: true };
    }
    return { ok: false, error: `Unknown kind: ${kind}` };
}

/** Same rules as resolveDashboardActionRepoPath (avoid importing dashboard-server). */
function resolveRepoForScheduleCli(explicitRepo) {
    const repos = readConductorReposFromGlobalConfig().map(r => path.resolve(String(r)));
    const defaultRepo = path.resolve(process.cwd());
    const requested = explicitRepo ? path.resolve(String(explicitRepo).trim()) : '';

    if (requested) {
        if (repos.length > 0 && !repos.includes(requested)) {
            return { ok: false, error: 'repoPath is not registered with dashboard' };
        }
        return { ok: true, repoPath: requested };
    }
    if (repos.length === 1) return { ok: true, repoPath: repos[0] };
    if (repos.length > 1) {
        if (repos.includes(defaultRepo)) return { ok: true, repoPath: defaultRepo };
        return { ok: false, error: 'repoPath is required when multiple repos are registered' };
    }
    return { ok: true, repoPath: defaultRepo };
}

function addJob(repoPath, jobInput) {
    const repo = normalizeRepoPath(repoPath);
    const runAt = parseRunAt(jobInput.runAt);
    if (!runAt.ok) return runAt;

    const kind = String(jobInput.kind || '').trim();
    const entityId = String(jobInput.entityId || '').trim();
    if (!entityId || !/^\d+$/.test(entityId)) return { ok: false, error: 'entityId must be numeric' };

    const entityCheck = assertEntitySchedulable(repo, kind, entityId);
    if (!entityCheck.ok) return entityCheck;

    let payload;
    if (kind === 'feature_autonomous') {
        const v = validateFeatureAutonomousPayload(
            { featureId: entityId, ...jobInput.payload },
            agentRegistry
        );
        if (!v.ok) return v;
        payload = v.normalized;
    } else if (kind === 'research_start') {
        const v = validateResearchStartPayload(jobInput.payload || {}, agentRegistry);
        if (!v.ok) return v;
        payload = v.normalized;
    } else {
        return { ok: false, error: 'kind must be feature_autonomous or research_start' };
    }

    const job = {
        jobId: newJobId(),
        runAt: runAt.iso,
        kind,
        entityId,
        repoPath: repo,
        payload,
        createdAt: new Date().toISOString(),
        status: 'pending',
    };

    return withStoreLockSync(repo, () => {
        const store = readStoreUnlocked(repo);
        store.jobs.push(job);
        writeStoreUnlocked(repo, store);
        return { ok: true, job };
    });
}

function listJobs(repoPath, { includeAll = false } = {}) {
    const repo = normalizeRepoPath(repoPath);
    return withStoreLockSync(repo, () => {
        const { jobs } = readStoreUnlocked(repo);
        const filtered = includeAll ? jobs.slice() : jobs.filter(j => j.status === 'pending');
        filtered.sort((a, b) => String(a.runAt).localeCompare(String(b.runAt)));
        return filtered;
    });
}

function cancelJob(repoPath, jobId) {
    const id = String(jobId || '').trim();
    if (!id) return { ok: false, error: 'jobId is required' };
    const repo = normalizeRepoPath(repoPath);
    return withStoreLockSync(repo, () => {
        const store = readStoreUnlocked(repo);
        const job = store.jobs.find(j => j.jobId === id);
        if (!job) return { ok: false, error: `No job with id ${id}` };
        if (job.status === 'fired') return { ok: false, error: 'Job already fired' };
        if (job.status === 'cancelled') return { ok: true, job, noop: true };
        if (job.status === 'failed') return { ok: false, error: 'Job already failed' };
        if (job.status === 'firing') return { ok: false, error: 'Job is currently being executed' };
        job.status = 'cancelled';
        job.cancelledAt = new Date().toISOString();
        writeStoreUnlocked(repo, store);
        return { ok: true, job };
    });
}

function buildSpawnArgvForJob(job) {
    if (job.kind === 'feature_autonomous') {
        return buildFeatureAutonomousCliArgv(job.payload);
    }
    if (job.kind === 'research_start') {
        return buildResearchStartArgv(job.entityId, job.payload);
    }
    throw new Error(`Unsupported job kind: ${job.kind}`);
}

function truncateErr(s) {
    const t = String(s || '').trim();
    if (t.length <= TRUNCATE_ERR) return t;
    return `${t.slice(0, TRUNCATE_ERR)}…`;
}

function runOneDueJob(repoPath, job, deps) {
    const {
        cliEntryPath,
        spawnSyncImpl,
        env,
    } = deps;
    const spawnFn = spawnSyncImpl || spawnSync;
    const argvTail = buildSpawnArgvForJob(job);
    const result = spawnFn(process.execPath, [cliEntryPath, ...argvTail], {
        cwd: job.repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: env || { ...process.env, GIT_TERMINAL_PROMPT: '0', AIGON_INVOKED_BY_DASHBOARD: '1' },
    });
    if (result.error) {
        return { ok: false, error: truncateErr(result.error.message) };
    }
    const code = typeof result.status === 'number' ? result.status : 1;
    if (code !== 0) {
        const stderr = truncateErr(result.stderr || '');
        return { ok: false, error: stderr || `exit code ${code}` };
    }
    return { ok: true };
}

/**
 * Claim due pending jobs (pending → firing), then execute outside the lock, then finalize.
 */
function processRepoDueJobs(repoPath, deps) {
    const nowMs = deps.now ? deps.now() : Date.now();
    const cliEntryPath = deps.cliEntryPath || path.join(__dirname, '..', 'aigon-cli.js');

    const claimed = withStoreLockSync(repoPath, () => {
        const store = readStoreUnlocked(repoPath);
        const out = [];
        for (const job of store.jobs) {
            if (job.status !== 'pending') continue;
            const pr = parseRunAt(job.runAt);
            const due = pr.ok && pr.ms <= nowMs;
            if (!due) continue;
            job.status = 'firing';
            out.push(job);
        }
        if (out.length) writeStoreUnlocked(repoPath, store);
        return out;
    });

    for (const job of claimed) {
        const run = runOneDueJob(job.repoPath, job, { ...deps, cliEntryPath });
        withStoreLockSync(job.repoPath, () => {
            const store = readStoreUnlocked(job.repoPath);
            const j = store.jobs.find(x => x.jobId === job.jobId);
            if (!j || j.status !== 'firing') return;
            if (run.ok) {
                j.status = 'fired';
                j.firedAt = new Date().toISOString();
            } else {
                j.status = 'failed';
                j.error = run.error;
            }
            writeStoreUnlocked(job.repoPath, store);
        });
    }
    return claimed.length;
}

function collectRepoRoots(getRepoRoots) {
    let roots = typeof getRepoRoots === 'function' ? getRepoRoots() : null;
    if (!Array.isArray(roots) || roots.length === 0) {
        const repos = readConductorReposFromGlobalConfig();
        roots = (Array.isArray(repos) && repos.length > 0)
            ? repos.map(normalizeRepoPath)
            : [normalizeRepoPath(process.cwd())];
    }
    return roots;
}

function processAllReposDueJobs(deps = {}) {
    const roots = collectRepoRoots(deps.getRepoRoots);
    let n = 0;
    for (const root of roots) {
        try {
            n += processRepoDueJobs(root, deps);
        } catch (e) {
            const log = deps.log || console.log;
            log(`[scheduled-kickoff] ${root}: ${e && e.message}`);
        }
    }
    return n;
}

let _timer = null;
let _inflight = null;

/** Keys for numeric entity ids include both padded and unpadded forms (e.g. "07" and "7"). */
function scheduleEntityKeyVariants(entityId) {
    const s = String(entityId || '').trim();
    const out = new Set([s]);
    if (/^\d+$/.test(s)) out.add(String(parseInt(s, 10)));
    return [...out];
}

/**
 * Pending jobs only. Earliest runAt wins per entity id (dashboard schedule glyph).
 * @param {string} repoPath
 * @returns {{ lookupFeature: (id: string) => { runAt: string, kind: string } | null, lookupResearch: (id: string) => { runAt: string, kind: string } | null }}
 */
function buildPendingScheduleIndex(repoPath) {
    const repo = normalizeRepoPath(repoPath);
    let jobs = [];
    try {
        jobs = listJobs(repo, { includeAll: false });
    } catch (_) {
        jobs = [];
    }
    const featureBest = new Map();
    const researchBest = new Map();

    function upsert(targetMap, entityId, runAt, kind) {
        const pr = parseRunAt(runAt);
        if (!pr.ok) return;
        for (const k of scheduleEntityKeyVariants(entityId)) {
            const prev = targetMap.get(k);
            if (!prev || pr.ms < prev.ms) {
                targetMap.set(k, { runAt, ms: pr.ms, kind });
            }
        }
    }

    for (const j of jobs) {
        if (j.status !== 'pending') continue;
        if (j.kind === 'feature_autonomous') upsert(featureBest, j.entityId, j.runAt, j.kind);
        else if (j.kind === 'research_start') upsert(researchBest, j.entityId, j.runAt, j.kind);
    }

    function lookup(targetMap, cardId) {
        let best = null;
        for (const k of scheduleEntityKeyVariants(cardId)) {
            const hit = targetMap.get(k);
            if (hit && (!best || hit.ms < best.ms)) best = hit;
        }
        return best ? { runAt: best.runAt, kind: best.kind } : null;
    }

    return {
        lookupFeature: (id) => lookup(featureBest, id),
        lookupResearch: (id) => lookup(researchBest, id),
    };
}

function startScheduledKickoffPoller(deps = {}) {
    const interval = deps.intervalMs || DEFAULT_POLL_MS;
    const log = deps.log || (() => {});

    async function tick() {
        if (_inflight) return _inflight;
        _inflight = Promise.resolve()
            .then(() => processAllReposDueJobs(deps))
            .catch(e => { log(`[scheduled-kickoff] tick: ${e && e.message}`); })
            .finally(() => { _inflight = null; });
        return _inflight;
    }

    tick();
    _timer = setInterval(() => { tick(); }, interval);
    if (typeof _timer.unref === 'function') _timer.unref();

    return {
        stop() {
            if (_timer) clearInterval(_timer);
            _timer = null;
        },
        tick,
    };
}

module.exports = {
    STORE_VERSION,
    DEFAULT_POLL_MS,
    getStorePath,
    parseRunAt,
    validateResearchStartPayload,
    buildResearchStartArgv,
    assertEntitySchedulable,
    resolveRepoForScheduleCli,
    addJob,
    listJobs,
    cancelJob,
    buildSpawnArgvForJob,
    processRepoDueJobs,
    processAllReposDueJobs,
    startScheduledKickoffPoller,
    normalizeRepoPath,
    buildPendingScheduleIndex,
};
