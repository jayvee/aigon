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
const AUTO_CLEAR_MIN_SCANS = 2;
const AUTO_CLEAR_MIN_MS = 60_000;

/** @type Map<string, { resetAt: string|null, patternId: string|null }> */
const emittedDedupe = new Map();

/**
 * Track consecutive "alive-but-paused" scan ticks per entity/agent.
 * Key: "entityType:entityId:agentId"
 * @type {Map<string, number>}
 */
const postPauseAliveCounts = new Map();

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
 * Strip lines that contain the agent's own error-pattern definitions to prevent
 * the detector from matching its own regex source (e.g. when an agent reads cc.json).
 */
function sanitisePaneSample(paneText, agentConfig) {
    const patterns = (agentConfig && agentConfig.quota && Array.isArray(agentConfig.quota.errorPatterns))
        ? agentConfig.quota.errorPatterns
        : [];
    const matchSources = patterns.map(p => p.match).filter(Boolean);
    const agentId = agentConfig && agentConfig.id;
    return String(paneText || '').split('\n').filter(line => {
        if (line.includes('"errorPatterns"')) return false;
        if (agentId && line.includes(`templates/agents/${agentId}.json`)) return false;
        for (const src of matchSources) {
            if (line.includes(src)) return false;
        }
        return true;
    }).join('\n');
}

async function emitSignalCleared(repoPath, { entityType, entityId, agentId, sessionName, quotaPausedAt }) {
    const elapsed = Math.round((Date.now() - (quotaPausedAt || 0)) / 1000);
    console.warn(`[quota-mid-run] quota.signal_cleared: ${entityType}:${entityId}:${agentId} — stale paused signal cleared after ${elapsed}s with continued activity`);

    const atISO = new Date().toISOString();
    const ev = [{
        type: 'quota.signal_cleared',
        agentId,
        sessionName: sessionName || null,
        pausedAt: quotaPausedAt ? new Date(quotaPausedAt).toISOString() : null,
        at: atISO,
    }];

    await workflowEngine.persistEntityEvents(repoPath, entityType, entityId, ev).catch(err => {
        if (process.env.DEBUG) console.error('[quota-mid-run] signal_cleared persist:', err && err.message);
    });

    // Restore agent status to prior state so the scanner can re-detect genuine pauses
    const existing = agentStatus.readAgentStatus(
        entityId, agentId, entityType === 'research' ? 'research' : 'feature', { mainRepoPath: repoPath },
    );
    if (existing && existing.priorQuotaStatus) {
        const writer = (patch) => agentStatus.writeAgentStatus(
            entityId, agentId, patch, entityType === 'research' ? 'research' : 'feature', { mainRepoPath: repoPath },
        );
        writer({ status: existing.priorQuotaStatus, priorQuotaStatus: null, quotaPausedAt: null, quotaPauseMeta: null });
    }

    // Clear dedupe so a genuine pause can be re-detected immediately
    for (const [k] of emittedDedupe) {
        if (k.startsWith(`${entityType}${entityId}${agentId}`)) emittedDedupe.delete(k);
    }
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

        const agentId = String(sidecar.agent);
        const pid = `${entityType}:${entityId}:${sessionName}:${agentId}`;
        const existingPaused = agentStatus.readAgentStatus(
            entityId,
            agentId,
            entityType === 'research' ? 'research' : 'feature',
            { mainRepoPath: repoPath },
        );
        const existingStatus = existingPaused && String(existingPaused.status);
        // Skip agents already paused (avoid re-emit) OR already in a terminal/completion
        // state — a completed agent's stale pane buffer must not re-trigger a pause.
        if (existingStatus === 'quota-paused') {
            // Auto-clear: if the session keeps producing activity after the pause was
            // recorded, the pause was likely a false positive (e.g. diff line number).
            const clearKey = `${entityType}:${entityId}:${agentId}`;
            const pausedAt = existingPaused.quotaPausedAt ? new Date(existingPaused.quotaPausedAt).getTime() : 0;
            const elapsedMs = Date.now() - pausedAt;
            const prevCount = postPauseAliveCounts.get(clearKey) || 0;
            const newCount = prevCount + 1;
            postPauseAliveCounts.set(clearKey, newCount);
            // Update activity cache so F454 doesn't re-skip this session next scan
            if (currentEpoch !== undefined) lastActivityByName.set(sessionName, currentEpoch);
            if (newCount >= AUTO_CLEAR_MIN_SCANS && elapsedMs >= AUTO_CLEAR_MIN_MS) {
                postPauseAliveCounts.delete(clearKey);
                emitSignalCleared(repoPath, {
                    entityType, entityId, agentId, sessionName,
                    quotaPausedAt: pausedAt || null,
                }).catch(err => {
                    if (deps.logger) deps.logger(`[quota-mid-run] signal_cleared: ${err && err.message}`);
                });
            }
            continue;
        }
        if (existingStatus === 'research-complete'
            || existingStatus === 'implementation-complete'
            || existingStatus === 'revision-complete'
            || existingStatus === 'spec-review-complete'
            || existingStatus === 'submitted') continue; // F501 backward compat: old agent status files
        // Reset auto-clear counter when agent is no longer paused
        postPauseAliveCounts.delete(`${entityType}:${entityId}:${agentId}`);

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

        const sanitisedPane = sanitisePaneSample(paneText, cfg);
        const classified = quotaProbe.classifyProbeResult(cfg, { ok: false, stdout: sanitisedPane });

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
    sanitisePaneSample,
    postPauseAliveCounts,
};
