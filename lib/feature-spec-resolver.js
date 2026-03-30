'use strict';

const fs = require('fs');
const path = require('path');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getSpecPath, LIFECYCLE_TO_FEATURE_DIR } = require('./workflow-core/paths');

const VISIBLE_STAGE_DIRS = Object.freeze([
    { dir: '01-inbox', stage: 'inbox' },
    { dir: '02-backlog', stage: 'backlog' },
    { dir: '03-in-progress', stage: 'in-progress' },
    { dir: '04-in-evaluation', stage: 'in-evaluation' },
    { dir: '05-done', stage: 'done' },
    { dir: '06-paused', stage: 'paused' },
]);

const PLACEHOLDER_MARKER = 'Spec created by workflow-core.';

function getFeatureIdCandidates(featureId) {
    const raw = String(featureId);
    const padded = /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw;
    const unpadded = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
    return [...new Set([padded, unpadded, raw].filter(Boolean))];
}

function safeReadDir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch (_) {
        return [];
    }
}

function pathExists(targetPath) {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch (_) {
        return false;
    }
}

function isPlaceholderSpecContent(content) {
    return String(content || '').includes(PLACEHOLDER_MARKER);
}

function isPlaceholderSpecPath(specPath) {
    if (!specPath || !pathExists(specPath)) return false;
    try {
        return isPlaceholderSpecContent(fs.readFileSync(specPath, 'utf8'));
    } catch (_) {
        return false;
    }
}

function listVisibleFeatureSpecs(repoPath, featureId) {
    const prefixes = getFeatureIdCandidates(featureId).map(candidate => `feature-${candidate}-`);
    const featuresRoot = path.join(repoPath, 'docs', 'specs', 'features');
    const matches = [];

    VISIBLE_STAGE_DIRS.forEach(({ dir, stage }) => {
        const fullDir = path.join(featuresRoot, dir);
        safeReadDir(fullDir)
            .filter(file => prefixes.some(prefix => file.startsWith(prefix)) && file.endsWith('.md'))
            .forEach(file => {
                const fullPath = path.join(fullDir, file);
                matches.push({
                    file,
                    path: fullPath,
                    stage,
                    isPlaceholder: isPlaceholderSpecPath(fullPath),
                });
            });
    });

    return matches;
}

function getExpectedStageFromSnapshot(snapshot) {
    return snapshot ? workflowSnapshotAdapter.snapshotToStage(snapshot) : null;
}

function getExpectedVisiblePath(repoPath, featureId, snapshot) {
    const lifecycle = snapshot && (snapshot.lifecycle || snapshot.currentSpecState);
    if (!lifecycle) return null;
    return getSpecPath(repoPath, featureId, lifecycle);
}

function rankCandidate(candidate, expectedPath) {
    const matchesExpected = expectedPath && candidate.path === expectedPath;
    if (!candidate.isPlaceholder && matchesExpected) return 0;
    if (!candidate.isPlaceholder) return 1;
    if (matchesExpected) return 2;
    return 3;
}

function resolveFeatureSpec(repoPath, featureId, options = {}) {
    const idCandidates = getFeatureIdCandidates(featureId);
    const snapshot = options.snapshot === undefined
        ? idCandidates
            .map(candidate => workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, candidate))
            .find(Boolean) || null
        : options.snapshot;
    const matches = listVisibleFeatureSpecs(repoPath, featureId);
    const expectedPath = getExpectedVisiblePath(repoPath, featureId, snapshot);
    const expectedStage = getExpectedStageFromSnapshot(snapshot);

    const ranked = matches
        .slice()
        .sort((left, right) => rankCandidate(left, expectedPath) - rankCandidate(right, expectedPath));
    const selected = ranked[0] || null;

    if (selected) {
        return {
            featureId: getFeatureIdCandidates(featureId)[0],
            path: selected.path,
            file: selected.file,
            stage: selected.stage,
            expectedStage,
            isPlaceholder: selected.isPlaceholder,
            source: selected.path === expectedPath ? 'workflow-visible' : 'visible-fallback',
            snapshot,
        };
    }

    if (expectedPath) {
        return {
            featureId: getFeatureIdCandidates(featureId)[0],
            path: expectedPath,
            file: path.basename(expectedPath),
            stage: expectedStage,
            expectedStage,
            isPlaceholder: false,
            source: 'workflow-expected',
            snapshot,
        };
    }

    return {
        featureId: getFeatureIdCandidates(featureId)[0],
        path: null,
        file: null,
        stage: null,
        expectedStage: null,
        isPlaceholder: false,
        source: 'missing',
        snapshot,
    };
}

module.exports = {
    PLACEHOLDER_MARKER,
    VISIBLE_STAGE_DIRS,
    isPlaceholderSpecContent,
    isPlaceholderSpecPath,
    listVisibleFeatureSpecs,
    resolveFeatureSpec,
};
