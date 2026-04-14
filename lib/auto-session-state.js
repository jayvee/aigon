'use strict';

const fs = require('fs');
const path = require('path');

function normalizeFeatureId(featureId) {
    const raw = String(featureId || '').trim();
    if (!raw) return raw;
    const parsed = parseInt(raw, 10);
    return String(Number.isNaN(parsed) ? raw : parsed).padStart(2, '0');
}

function getFeatureAutoStatePath(repoPath, featureId) {
    return path.join(repoPath, '.aigon', 'state', `feature-${normalizeFeatureId(featureId)}-auto.json`);
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

module.exports = {
    normalizeFeatureId,
    getFeatureAutoStatePath,
    readFeatureAutoState,
    writeFeatureAutoState,
    clearFeatureAutoState,
};
