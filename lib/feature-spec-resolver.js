'use strict';

const fs = require('fs');
const path = require('path');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getSpecPathForEntity } = require('./workflow-core/paths');

const VISIBLE_STAGE_DIRS = Object.freeze([
    { dir: '01-inbox', stage: 'inbox' },
    { dir: '02-backlog', stage: 'backlog' },
    { dir: '03-in-progress', stage: 'in-progress' },
    { dir: '04-in-evaluation', stage: 'in-evaluation' },
    { dir: '05-done', stage: 'done' },
    { dir: '06-paused', stage: 'paused' },
]);

const PLACEHOLDER_MARKER = 'Spec created by workflow-core.';

const ENTITY_CONFIG = Object.freeze({
    feature: {
        prefix: 'feature',
        docsDir: path.join('docs', 'specs', 'features'),
        snapshotReader: (repoPath, entityId) => workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, entityId),
    },
    research: {
        prefix: 'research',
        docsDir: path.join('docs', 'specs', 'research-topics'),
        snapshotReader: (repoPath, entityId) => workflowSnapshotAdapter.readWorkflowSnapshotSync(repoPath, 'research', entityId),
    },
});

function getEntityConfig(entityType) {
    return ENTITY_CONFIG[entityType] || ENTITY_CONFIG.feature;
}

function getEntityIdCandidates(entityId) {
    const raw = String(entityId);
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

function listVisibleEntitySpecs(repoPath, entityType, entityId) {
    const cfg = getEntityConfig(entityType);
    const prefixes = getEntityIdCandidates(entityId).map(candidate => `${cfg.prefix}-${candidate}-`);
    const visibleRoot = path.join(repoPath, cfg.docsDir);
    const matches = [];

    VISIBLE_STAGE_DIRS.forEach(({ dir, stage }) => {
        const fullDir = path.join(visibleRoot, dir);
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

function listVisibleFeatureSpecs(repoPath, featureId) {
    return listVisibleEntitySpecs(repoPath, 'feature', featureId);
}

function getExpectedStageFromSnapshot(snapshot) {
    return snapshot ? workflowSnapshotAdapter.snapshotToStage(snapshot) : null;
}

function getExpectedVisiblePath(repoPath, entityType, entityId, snapshot) {
    const lifecycle = snapshot && (snapshot.lifecycle || snapshot.currentSpecState);
    if (!lifecycle) return null;
    return getSpecPathForEntity(repoPath, entityType, entityId, lifecycle, { snapshot });
}

function rankCandidate(candidate, expectedPath) {
    const matchesExpected = expectedPath && candidate.path === expectedPath;
    if (!candidate.isPlaceholder && matchesExpected) return 0;
    if (!candidate.isPlaceholder) return 1;
    if (matchesExpected) return 2;
    return 3;
}

function readSnapshot(repoPath, entityType, entityId) {
    return getEntityConfig(entityType).snapshotReader(repoPath, entityId);
}

function buildResolvedEntity(entityType, entityId, details) {
    const key = entityType === 'research' ? 'researchId' : 'featureId';
    return {
        [key]: entityId,
        entityId,
        ...details,
    };
}

function resolveEntitySpec(repoPath, entityType, entityId, options = {}) {
    const normalizedEntityType = entityType === 'research' ? 'research' : 'feature';
    const idCandidates = getEntityIdCandidates(entityId);
    const snapshot = options.snapshot === undefined
        ? idCandidates.map(candidate => readSnapshot(repoPath, normalizedEntityType, candidate)).find(Boolean) || null
        : options.snapshot;
    const matches = listVisibleEntitySpecs(repoPath, normalizedEntityType, entityId);
    const expectedPath = getExpectedVisiblePath(repoPath, normalizedEntityType, entityId, snapshot);
    const expectedStage = getExpectedStageFromSnapshot(snapshot);

    const ranked = matches
        .slice()
        .sort((left, right) => rankCandidate(left, expectedPath) - rankCandidate(right, expectedPath));
    const selected = ranked[0] || null;
    const resolvedEntityId = getEntityIdCandidates(entityId)[0];

    if (selected) {
        return buildResolvedEntity(normalizedEntityType, resolvedEntityId, {
            path: selected.path,
            file: selected.file,
            stage: selected.stage,
            expectedStage,
            isPlaceholder: selected.isPlaceholder,
            source: selected.path === expectedPath ? 'workflow-visible' : 'visible-fallback',
            snapshot,
        });
    }

    if (expectedPath) {
        return buildResolvedEntity(normalizedEntityType, resolvedEntityId, {
            path: expectedPath,
            file: path.basename(expectedPath),
            stage: expectedStage,
            expectedStage,
            isPlaceholder: false,
            source: 'workflow-expected',
            snapshot,
        });
    }

    return buildResolvedEntity(normalizedEntityType, resolvedEntityId, {
        path: null,
        file: null,
        stage: null,
        expectedStage: null,
        isPlaceholder: false,
        source: 'missing',
        snapshot,
    });
}

function resolveFeatureSpec(repoPath, featureId, options = {}) {
    return resolveEntitySpec(repoPath, 'feature', featureId, options);
}

function resolveResearchSpec(repoPath, researchId, options = {}) {
    return resolveEntitySpec(repoPath, 'research', researchId, options);
}

module.exports = {
    PLACEHOLDER_MARKER,
    VISIBLE_STAGE_DIRS,
    isPlaceholderSpecContent,
    isPlaceholderSpecPath,
    listVisibleEntitySpecs,
    listVisibleFeatureSpecs,
    resolveEntitySpec,
    resolveFeatureSpec,
    resolveResearchSpec,
};
