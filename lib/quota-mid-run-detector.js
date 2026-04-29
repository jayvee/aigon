'use strict';

/**
 * F446 Mid-run quota detection via tmux pane scan (runs from dashboard-server pollStatus, F454+).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const agentRegistry = require('./agent-registry');
const quotaProbe = require('./quota-probe');
const agentStatus = require('./agent-status');
const { runTmux, resolveTmuxTarget, tmuxSessionExists } = require('./worktree');
const workflowEngine = require('./workflow-core');

const CAPTURE_PANE_LINES = 160;

/** @type Map<string, { resetAt: string|null, patternId: string|null }> */
const emittedDedupe = new Map();

/**
 * F454: cache `tmux #{session_activity}` per session name. When the activity
 * epoch is unchanged since the last scan the pane buffer cannot have new
 * output, so we skip both `tmuxSessionExists` and `capture-pane` for that
 * sidecar. Stale entries (sessions that ended) age out naturally — they are
 * only consulted when a sidecar still names the session.
 *
 * @type {Map<string, number>}
 */
const lastActivityByName = new Map();

function listSessionActivities() {
    const result = runTmux(
        ['list-sessions', '-F', '#{session_name} #{session_activity}'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.error || result.status !== 0) return null;
    const map = new Map();
    String(result.stdout || '').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const idx = trimmed.indexOf(' ');
        if (idx === -1) return;
        const name = trimmed.slice(0, idx);
        const epoch = parseInt(trimmed.slice(idx + 1), 10);
        if (Number.isFinite(epoch)) map.set(name, epoch);
    });
    return map;
}

function paneSampleHash(paneText) {
    return crypto.createHash('sha256').update(String(paneText || '')).digest('hex').slice(0, 16);
}

function dedupeCompositeKey(entityType, entityId, agentId, sessionName, patternId) {
    return [entityType, entityId, agentId, sessionName, patternId].join('\u0001');
}

function capturePaneText(sessionName, tmuxId) {
    const { target } = resolveTmuxTarget(tmuxId, sessionName);
    const result = runTmux(['capture-pane', '-p', '-t', target, '-S', `-${CAPTURE_PANE_LINES}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) return null;
    return String(result.stdout || '');
}

function stripAnsi(raw) {
    return String(raw || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

/**
 * Persist agent quota pause; merge quota.json and append workflow events when dedupe permits.
 *
 * REGRESSION (F446): Repeated pane matches with unchanged reset pattern must emit one event only.
 */
function persistQuotaPause(repoPath, {
    entityType,
    entityId,
    agentId,
    role,
    sessionName,
    tmuxId,
    modelValue,
    patternId,
    resetAt,
    paneText,
    classified,
}) {
    const paneHash = paneSampleHash(paneText || '');
    const prefix = entityType === 'research' ? 'research' : 'feature';
    const ck = dedupeCompositeKey(entityType, String(entityId), agentId, sessionName, patternId);
    const resetKey = resetAt || null;
    const prevEmit = emittedDedupe.get(ck);
    if (prevEmit && prevEmit.patternId === patternId && prevEmit.resetAt === resetKey) {
        return false;
    }

    emittedDedupe.set(ck, { patternId, resetAt: resetKey });

    let modelLabel = null;
    try {
        if (prefix === 'feature') {
            const snapPath = path.join(repoPath, '.aigon', 'workflows', 'features', String(entityId), 'snapshot.json');
            if (fs.existsSync(snapPath)) {
                const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
                const mo = snap.agents && snap.agents[agentId] && snap.agents[agentId].modelOverride;
                if (mo && typeof mo.model === 'string') modelLabel = mo.model;
            }
        } else if (prefix === 'research') {
            const snapPath = path.join(repoPath, '.aigon', 'workflows', 'research', String(entityId), 'snapshot.json');
            if (fs.existsSync(snapPath)) {
                const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
                const mo = snap.agents && snap.agents[agentId] && snap.agents[agentId].modelOverride;
                if (mo && typeof mo.model === 'string') modelLabel = mo.model;
            }
        }
    } catch (_) { /* best-effort */ }

    quotaProbe.mergeMidRunDepletion(repoPath, agentId, modelValue, modelLabel, paneText || '', classified);

    const existing = prefix === 'research'
        ? agentStatus.readAgentStatus(entityId, agentId, 'research', { mainRepoPath: repoPath })
        : agentStatus.readAgentStatus(entityId, agentId, 'feature', { mainRepoPath: repoPath });

    const prevStatusForResume = existing && existing.status && existing.status !== 'quota-paused'
        ? String(existing.status)
        : String((existing && existing.priorQuotaStatus) || 'implementing');

    const statusWriter = prefix === 'research'
        ? (patch) => agentStatus.writeAgentStatus(entityId, agentId, patch, 'research', { mainRepoPath: repoPath })
        : (patch) => agentStatus.writeAgentStatus(entityId, agentId, patch, 'feature', { mainRepoPath: repoPath });

    const atISO = new Date().toISOString();

    statusWriter({
        status: 'quota-paused',
        priorQuotaStatus: prevStatusForResume,
        quotaPausedAt: atISO,
        quotaPauseMeta: {
            patternId,
            resetAt,
            sessionName,
            tmuxId: tmuxId || null,
            role: role || 'do',
        },
    });

    const ev = [{
        type: `${prefix}.agent_quota_paused`,
        agentId,
        role,
        sessionName,
        tmuxId: tmuxId || undefined,
        modelValue: modelValue || undefined,
        patternId,
        resetAt,
        detectedAt: atISO,
        paneSampleHash: paneHash,
        at: atISO,
    }];

    workflowEngine.persistEntityEvents(repoPath, entityType, entityId, ev)
        .catch((err) => {
            emittedDedupe.delete(ck);
            if (process.env.DEBUG) {
                console.error('[quota-mid-run] persistEntityEvents:', err && err.message);
            }
        });

    return true;
}

function resolveModelValueFromRepo(repoPath, entityType, entityId, agentId) {
    const subdir = entityType === 'research' ? 'research' : 'features';
    try {
        const snapPath = path.join(repoPath, '.aigon', 'workflows', subdir, String(entityId), 'snapshot.json');
        if (!fs.existsSync(snapPath)) return null;
        const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
        const mo = snap.agents && snap.agents[agentId] && snap.agents[agentId].modelOverride;
        return (mo && mo.model) ? String(mo.model) : null;
    } catch (_) {
        return null;
    }
}

/**
 * Poll every active entity session sidecar; detect quota exhaustion in pane buffers.
 *
 * @param {string} repoPath
 * @param {object} [deps]
 */
async function scanActiveSessions(repoPath, deps = {}) {
    const sessionsDir = path.join(repoPath, '.aigon', 'sessions');
    if (!fs.existsSync(sessionsDir)) return;

    let entries;
    try {
        entries = fs.readdirSync(sessionsDir);
    } catch (_) {
        return;
    }

    const persistQuotaPauseFn = typeof deps.persistQuotaPause === 'function' ? deps.persistQuotaPause : persistQuotaPause;
    const capturePaneTextFn = typeof deps.capturePaneText === 'function' ? deps.capturePaneText : capturePaneText;
    const tmuxSessionExistsFn = typeof deps.tmuxSessionExists === 'function' ? deps.tmuxSessionExists : tmuxSessionExists;

    // F454: one cheap `tmux list-sessions` call gates all per-session work
    // below. If a session's activity epoch is unchanged from the previous
    // scan, the pane buffer can't have new output — skip both
    // `tmuxSessionExists` and `capture-pane`.
    const activityNow = (typeof deps.listSessionActivities === 'function'
        ? deps.listSessionActivities()
        : listSessionActivities()) || new Map();

    let captureCount = 0;

    for (const f of entries) {
        if (!f.endsWith('.json')) continue;
        let sidecar;
        try {
            sidecar = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
        } catch (_) {
            continue;
        }
        if (!sidecar || typeof sidecar !== 'object') continue;
        if (sidecar.category === 'repo') continue;
        const etRaw = sidecar.entityType || '';
        if (etRaw !== 'f' && etRaw !== 'r') continue;

        const sessionName = sidecar.sessionName || path.basename(f, '.json');
        if (!sidecar.agent) continue;

        const role = String(sidecar.role || 'do');
        if (role === 'auto' || role === 'set-auto') continue;

        const entityType = sidecar.entityType === 'r' ? 'research' : 'feature';
        const entityId = String(sidecar.entityId || '').trim();

        // Activity-gated skip: if the session is in `tmux list-sessions` and
        // its activity epoch matches the cached value, no new pane output
        // could have arrived since the last scan.
        const currentEpoch = activityNow.get(sessionName);
        if (currentEpoch !== undefined) {
            const cached = lastActivityByName.get(sessionName);
            if (cached !== undefined && cached === currentEpoch) continue;
        }

        let alive = currentEpoch !== undefined;
        if (!alive) {
            alive = tmuxSessionExistsFn(sessionName);
            if (!alive && sidecar.tmuxId) {
                const { target, isId } = resolveTmuxTarget(sidecar.tmuxId, sessionName);
                alive = tmuxSessionExistsFn(target);
                if (!isId) alive = alive || tmuxSessionExistsFn(sessionName);
            }
        }
        if (!alive) continue;

        const pid = `${entityType}:${entityId}:${sessionName}:${sidecar.agent}`;
        const existingPaused = agentStatus.readAgentStatus(
            entityId,
            sidecar.agent,
            entityType === 'research' ? 'research' : 'feature',
            { mainRepoPath: repoPath },
        );
        if (existingPaused && String(existingPaused.status) === 'quota-paused') continue;

        const agentId = String(sidecar.agent);
        let paneRaw;
        try {
            paneRaw = capturePaneTextFn(sessionName, sidecar.tmuxId);
        } catch (_) {
            continue;
        }

        // Yield every 4 sidecars that actually triggered a `capture-pane`
        // so the event loop drains.
        captureCount += 1;
        if (captureCount % 4 === 0) {
            await new Promise(r => setImmediate(r));
        }

        if (!paneRaw) continue;

        const paneText = stripAnsi(paneRaw);
        const cfg = agentRegistry.getAgent(agentId);
        if (!cfg) continue;

        const classified = quotaProbe.classifyProbeResult(cfg, { ok: false, stdout: paneText });

        // Update the activity-epoch cache after a successful classify so
        // subsequent unchanged epochs are skipped.
        if (currentEpoch !== undefined) {
            lastActivityByName.set(sessionName, currentEpoch);
        }

        if (!classified || classified.verdict !== 'depleted') continue;

        const patternId = classified.matchedPatternId || classified.verdict || 'depleted';

        try {
            const modelValue = resolveModelValueFromRepo(repoPath, entityType, entityId, agentId);

            persistQuotaPauseFn(repoPath, {
                entityType,
                entityId,
                agentId,
                role,
                sessionName,
                tmuxId: sidecar.tmuxId ? String(sidecar.tmuxId) : null,
                modelValue,
                patternId,
                resetAt: classified.resetAt || null,
                paneText,
                classified,
            });
        } catch (e) {
            if (deps.logger) deps.logger(`[quota-mid-run] ${pid}: ${e && e.message}`);
        }
    }
}

module.exports = {
    paneSampleHash,
    scanActiveSessions,
    persistQuotaPause,
    emittedDedupe,
    lastActivityByName,
    listSessionActivities,
};
