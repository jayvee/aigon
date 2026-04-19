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

    const expectedStage = visibleSpec.expectedStage || workflowSnapshotAdapter.snapshotToStage(snapshot) || null;

    // Guard: never move to anything outside <repoPath>/docs/specs/. The engine
    // path helper can legitimately return a fallback path under .aigon/workflows/
    // when a lifecycle state has no visible dir mapping — that path is internal
    // workflow state, not a user-facing spec location. Moving a spec file into
    // it would effectively delete the spec from the user's view.
    const docsRoot = path.join(repoPath, 'docs', 'specs') + path.sep;
    const expectedDir = path.dirname(expectedPath);
    if (!(expectedDir + path.sep).startsWith(docsRoot)) {
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
            skipped: 'expected-path-outside-docs',
        };
    }

    // Compare directories only — the reconciler moves a file to the correct
    // lifecycle folder but never renames it. If a snapshot disagrees with
    // the visible filename it is safer to preserve the on-disk name than to
    // rename (e.g. when two id-prefixed specs exist across stage dirs, path
    // derivation can pick a stale sibling's filename and clobber the real one).
    const currentDir = path.dirname(currentPath);
    const driftDetected = currentDir !== expectedDir;
    const targetPath = path.join(expectedDir, path.basename(currentPath));

    if (!driftDetected) {
        return {
            entityType: normalizedEntityType,
            entityId: normalizedId,
            snapshot,
            lifecycle,
            visibleStage: expectedStage || visibleSpec.stage || null,
            currentPath,
            expectedPath: targetPath,
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
            expectedPath: targetPath,
            driftDetected: true,
            moved: false,
            skipped: null,
        };
    }

    try {
        fs.mkdirSync(expectedDir, { recursive: true });
        if (fs.existsSync(targetPath)) {
            if (featureSpecResolver.isPlaceholderSpecPath(targetPath)) {
                fs.unlinkSync(targetPath);
            } else {
                const warning = `⚠️  Could not reconcile ${normalizedEntityType} ${normalizedId} spec path because destination already exists: ${toRelativeRepoPath(repoPath, targetPath)}`;
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
                    expectedPath: targetPath,
                    driftDetected: true,
                    moved: false,
                    skipped: 'destination-exists',
                };
            }
        }
        fs.renameSync(currentPath, targetPath);
    } catch (err) {
        const warning = `⚠️  Could not reconcile ${normalizedEntityType} ${normalizedId} spec path (${toRelativeRepoPath(repoPath, currentPath)} -> ${toRelativeRepoPath(repoPath, targetPath)}): ${err.message}`;
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
            expectedPath: targetPath,
            driftDetected: true,
            moved: false,
            skipped: 'rename-failed',
            error: err.message,
        };
    }

    const warning = `⚠️  Reconciled ${normalizedEntityType} ${normalizedId} spec path: ${toRelativeRepoPath(repoPath, currentPath)} -> ${toRelativeRepoPath(repoPath, targetPath)}`;
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
        currentPath: targetPath,
        previousPath: currentPath,
        expectedPath: targetPath,
        driftDetected: true,
        moved: true,
        skipped: null,
    };
}

module.exports = {
    reconcileEntitySpec,
};
