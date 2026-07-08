'use strict';

const fs = require('fs');
const path = require('path');
const { withFeatureLockRetry } = require('./workflow-core/lock');

function normalizeFeatureId(featureId) {
    const raw = String(featureId || '').trim();
    if (!raw) return raw;
    const parsed = parseInt(raw, 10);
    return String(Number.isNaN(parsed) ? raw : parsed).padStart(2, '0');
}

function getFeatureAutoStatePath(repoPath, featureId) {
    return path.join(repoPath, '.aigon', 'state', `feature-${normalizeFeatureId(featureId)}-auto.json`);
}

function getSetAutoStatePath(repoPath, setSlug) {
    return path.join(repoPath, '.aigon', 'state', `set-${String(setSlug || '').trim()}-auto.json`);
}

function getSetAutoLockPath(repoPath, setSlug) {
    return path.join(repoPath, '.aigon', 'locks', `set-${String(setSlug || '').trim()}-auto.lock`);
}

function readFeatureAutoState(repoPath, featureId) {
    const statePath = getFeatureAutoStatePath(repoPath, featureId);
    if (!fs.existsSync(statePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

/**
 * When AutoConductor's tmux session dies without calling finishAuto (external
 * kill, crash), feature-*-auto.json can stay at running:true. Reconcile once
 * per read when the live auto session is gone.
 */
function reconcileStaleFeatureAutoState(repoPath, featureId, autoSessionRunning) {
    if (autoSessionRunning) return null;
    const persisted = readFeatureAutoState(repoPath, featureId);
    if (!persisted) return null;
    const patch = {};
    if (persisted.running) {
        patch.running = false;
        patch.status = 'failed';
        patch.reason = 'auto-session-lost';
        patch.endedAt = new Date().toISOString();
    } else if (persisted.status === 'died') {
        // Normalize legacy reconcile status so dashboard recovery surfaces work.
        patch.status = 'failed';
        if (!persisted.reason) patch.reason = 'auto-session-lost';
    }
    if (Object.keys(patch).length === 0) return persisted;
    return writeFeatureAutoState(repoPath, featureId, patch);
}

function writeFeatureAutoState(repoPath, featureId, patch) {
    const statePath = getFeatureAutoStatePath(repoPath, featureId);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const existing = readFeatureAutoState(repoPath, featureId) || {};
    const next = {
        ...existing,
        ...patch,
        featureId: normalizeFeatureId(featureId),
        updatedAt: new Date().toISOString(),
    };
    if (!next.startedAt) next.startedAt = next.updatedAt;
    fs.writeFileSync(statePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
}

function clearFeatureAutoState(repoPath, featureId) {
    const statePath = getFeatureAutoStatePath(repoPath, featureId);
    try {
        fs.unlinkSync(statePath);
        return true;
    } catch (_) {
        return false;
    }
}

const SET_PAUSED_STATUSES = new Set(['paused-on-failure', 'paused-on-quota']);

function readSetAutoState(repoPath, setSlug) {
    const statePath = getSetAutoStatePath(repoPath, setSlug);
    if (!fs.existsSync(statePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeSetAutoStateSync(repoPath, setSlug, patch) {
    const statePath = getSetAutoStatePath(repoPath, setSlug);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const existing = readSetAutoState(repoPath, setSlug) || {};
    const next = {
        ...existing,
        ...patch,
        setSlug: String(setSlug || '').trim(),
        updatedAt: new Date().toISOString(),
    };
    if (!next.startedAt) next.startedAt = next.updatedAt;
    fs.writeFileSync(statePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
}

/**
 * When a set pauses on a feature failure but that feature is later closed
 * externally, heal completed/failed pointers so resume can advance.
 */
function reconcileStaleSetAutoPauseState(repoPath, setSlug) {
    const persisted = readSetAutoState(repoPath, setSlug);
    if (!persisted) return null;
    const status = String(persisted.status || '');
    if (!SET_PAUSED_STATUSES.has(status)) return persisted;

    const healId = persisted.failedFeature || persisted.currentFeature
        || (Array.isArray(persisted.failed) && persisted.failed[0]);
    if (!healId) return persisted;

    const { isEntityDone } = require('./workflow-core/entity-lifecycle');
    if (!isEntityDone(repoPath, 'feature', healId, true)) return persisted;

    const id = String(healId);
    const completed = [...new Set([
        ...(Array.isArray(persisted.completed) ? persisted.completed : []).map(String),
        id,
    ])];
    const failed = (Array.isArray(persisted.failed) ? persisted.failed : []).map(String).filter((fid) => fid !== id);
    const patch = { completed, failed };
    if (String(persisted.failedFeature || '') === id) patch.failedFeature = null;
    if (String(persisted.currentFeature || '') === id) patch.currentFeature = null;
    return writeSetAutoStateSync(repoPath, setSlug, patch);
}

async function writeSetAutoState(repoPath, setSlug, patch) {
    const statePath = getSetAutoStatePath(repoPath, setSlug);
    const lockPath = getSetAutoLockPath(repoPath, setSlug);
    await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
    return withFeatureLockRetry(lockPath, async () => {
        const existing = readSetAutoState(repoPath, setSlug) || {};
        const next = {
            ...existing,
            ...patch,
            setSlug: String(setSlug || '').trim(),
            updatedAt: new Date().toISOString(),
        };
        if (!next.startedAt) next.startedAt = next.updatedAt;
        await fs.promises.writeFile(statePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
        return next;
    });
}

async function clearSetAutoState(repoPath, setSlug) {
    const statePath = getSetAutoStatePath(repoPath, setSlug);
    const lockPath = getSetAutoLockPath(repoPath, setSlug);
    return withFeatureLockRetry(lockPath, async () => {
        try {
            await fs.promises.unlink(statePath);
            return true;
        } catch (_) {
            return false;
        }
    });
}

module.exports = {
    normalizeFeatureId,
    getFeatureAutoStatePath,
    readFeatureAutoState,
    writeFeatureAutoState,
    reconcileStaleFeatureAutoState,
    clearFeatureAutoState,
    getSetAutoStatePath,
    readSetAutoState,
    writeSetAutoState,
    writeSetAutoStateSync,
    reconcileStaleSetAutoPauseState,
    clearSetAutoState,
    SET_PAUSED_STATUSES,
};
