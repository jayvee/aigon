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

function readSetAutoState(repoPath, setSlug) {
    const statePath = getSetAutoStatePath(repoPath, setSlug);
    if (!fs.existsSync(statePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_) {
        return null;
    }
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
    clearFeatureAutoState,
    getSetAutoStatePath,
    readSetAutoState,
    writeSetAutoState,
    clearSetAutoState,
};
