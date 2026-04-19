'use strict';

const fs = require('fs');
const path = require('path');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getSpecPathForEntity } = require('./workflow-core/paths');

function readWorkflowSnapshot(repoPath, entityType, entityId) {
    return entityType === 'research'
        ? workflowSnapshotAdapter.readWorkflowSnapshotSync(repoPath, 'research', entityId)
        : workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, entityId);
}

function normalizeEntityId(entityId) {
    const raw = String(entityId || '');
    if (!/^\d+$/.test(raw)) return raw;
    return raw.padStart(2, '0');
}

function toRelativeRepoPath(repoPath, targetPath) {
    return targetPath ? path.relative(repoPath, targetPath).replace(/\\/g, '/') : null;
}

function resolveLifecycle(snapshot) {
    return snapshot ? (snapshot.currentSpecState || snapshot.lifecycle || null) : null;
}

function reconcileEntitySpec(repoPath, entityType, entityId, options = {}) {
    const normalizedEntityType = entityType === 'research' ? 'research' : 'feature';
    const snapshot = options.snapshot === undefined
        ? readWorkflowSnapshot(repoPath, normalizedEntityType, entityId)
        : options.snapshot;
    const lifecycle = resolveLifecycle(snapshot);
    const normalizedId = normalizeEntityId(entityId);

    if (!snapshot || !lifecycle) {
        return {
            entityType: normalizedEntityType,
            entityId: normalizedId,
            snapshot: snapshot || null,
            lifecycle: lifecycle || null,
            visibleStage: null,
            currentPath: null,
            expectedPath: null,
            driftDetected: false,
            moved: false,
            skipped: 'missing-workflow-state',
        };
    }

    const visibleSpec = featureSpecResolver.resolveEntitySpec(repoPath, normalizedEntityType, normalizedId, { snapshot });
    const expectedPath = getSpecPathForEntity(repoPath, normalizedEntityType, normalizedId, lifecycle);
    const currentPath = visibleSpec.path;
    const currentVisibleFileExists = Boolean(
        currentPath &&
        visibleSpec.source !== 'workflow-expected' &&
        fs.existsSync(currentPath)
    );

    if (!currentVisibleFileExists || !expectedPath) {
        return {
            entityType: normalizedEntityType,
            entityId: normalizedId,
            snapshot,
            lifecycle,
            visibleStage: visibleSpec.expectedStage || visibleSpec.stage || null,
            currentPath: currentVisibleFileExists ? currentPath : null,
            expectedPath,
            driftDetected: false,
            moved: false,
            skipped: currentVisibleFileExists ? 'missing-expected-path' : 'missing-visible-spec',
        };
    }

    const driftDetected = currentPath !== expectedPath;
    const expectedStage = visibleSpec.expectedStage || workflowSnapshotAdapter.snapshotToStage(snapshot) || null;

    if (!driftDetected) {
        return {
            entityType: normalizedEntityType,
            entityId: normalizedId,
            snapshot,
            lifecycle,
            visibleStage: expectedStage || visibleSpec.stage || null,
            currentPath,
            expectedPath,
            driftDetected: false,
            moved: false,
            skipped: null,
        };
    }

    if (options.dryRun) {
        return {
            entityType: normalizedEntityType,
            entityId: normalizedId,
            snapshot,
            lifecycle,
            visibleStage: expectedStage,
            currentPath,
            expectedPath,
            driftDetected: true,
            moved: false,
            skipped: null,
        };
    }

    try {
        fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
        if (fs.existsSync(expectedPath)) {
            if (featureSpecResolver.isPlaceholderSpecPath(expectedPath)) {
                fs.unlinkSync(expectedPath);
            } else {
                const warning = `⚠️  Could not reconcile ${normalizedEntityType} ${normalizedId} spec path because destination already exists: ${toRelativeRepoPath(repoPath, expectedPath)}`;
                if (options.logger && typeof options.logger.warn === 'function') {
                    options.logger.warn(warning);
                } else {
                    console.warn(warning);
                }
                return {
                    entityType: normalizedEntityType,
                    entityId: normalizedId,
                    snapshot,
                    lifecycle,
                    visibleStage: expectedStage,
                    currentPath,
                    expectedPath,
                    driftDetected: true,
                    moved: false,
                    skipped: 'destination-exists',
                };
            }
        }
        fs.renameSync(currentPath, expectedPath);
    } catch (err) {
        const warning = `⚠️  Could not reconcile ${normalizedEntityType} ${normalizedId} spec path (${toRelativeRepoPath(repoPath, currentPath)} -> ${toRelativeRepoPath(repoPath, expectedPath)}): ${err.message}`;
        if (options.logger && typeof options.logger.warn === 'function') {
            options.logger.warn(warning);
        } else {
            console.warn(warning);
        }
        return {
            entityType: normalizedEntityType,
            entityId: normalizedId,
            snapshot,
            lifecycle,
            visibleStage: expectedStage,
            currentPath,
            expectedPath,
            driftDetected: true,
            moved: false,
            skipped: 'rename-failed',
            error: err.message,
        };
    }

    const warning = `⚠️  Reconciled ${normalizedEntityType} ${normalizedId} spec path: ${toRelativeRepoPath(repoPath, currentPath)} -> ${toRelativeRepoPath(repoPath, expectedPath)}`;
    if (options.logger && typeof options.logger.warn === 'function') {
        options.logger.warn(warning);
    } else {
        console.warn(warning);
    }

    return {
        entityType: normalizedEntityType,
        entityId: normalizedId,
        snapshot,
        lifecycle,
        visibleStage: expectedStage,
        currentPath: expectedPath,
        previousPath: currentPath,
        expectedPath,
        driftDetected: true,
        moved: true,
        skipped: null,
    };
}

module.exports = {
    reconcileEntitySpec,
};
