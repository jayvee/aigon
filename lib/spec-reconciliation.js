'use strict';

const fs = require('fs');
const path = require('path');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getSpecPathForEntity } = require('./workflow-core/paths');

const FEEDBACK_STATUS_TO_FOLDER = Object.freeze({
    inbox: '01-inbox',
    triaged: '02-triaged',
    actionable: '03-actionable',
    done: '04-done',
    'wont-fix': '05-wont-fix',
    duplicate: '06-duplicate',
});

const FEEDBACK_FOLDER_TO_STATUS = Object.freeze(
    Object.fromEntries(Object.entries(FEEDBACK_STATUS_TO_FOLDER).map(([status, folder]) => [folder, status]))
);

function normalizeFeedbackStatus(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    const aliasMap = {
        inbox: 'inbox',
        triaged: 'triaged',
        actionable: 'actionable',
        done: 'done',
        'wont-fix': 'wont-fix',
        wontfix: 'wont-fix',
        wont_fix: 'wont-fix',
        duplicate: 'duplicate',
    };
    return aliasMap[normalized] || null;
}

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

function getFeedbackRoot(repoPath) {
    return path.join(repoPath, 'docs', 'specs', 'feedback');
}

function matchesFeedbackEntityId(fileName, entityId) {
    const rawId = String(entityId || '');
    if (!rawId) return false;
    const paddedId = /^\d+$/.test(rawId) ? rawId.padStart(2, '0') : rawId;
    const unpaddedId = /^\d+$/.test(rawId) ? String(parseInt(rawId, 10)) : rawId;
    return fileName.startsWith(`feedback-${paddedId}-`) || fileName.startsWith(`feedback-${unpaddedId}-`);
}

function resolveFeedbackVisibleSpec(repoPath, entityId) {
    const feedbackRoot = getFeedbackRoot(repoPath);
    const folders = Object.values(FEEDBACK_STATUS_TO_FOLDER);

    for (const folder of folders) {
        const dir = path.join(feedbackRoot, folder);
        let files = [];
        try {
            files = fs.readdirSync(dir).sort();
        } catch (_) {
            continue;
        }

        for (const file of files) {
            if (!file.endsWith('.md') || !matchesFeedbackEntityId(file, entityId)) continue;
            return {
                path: path.join(dir, file),
                file,
                folder,
                stage: FEEDBACK_FOLDER_TO_STATUS[folder] || null,
            };
        }
    }

    return {
        path: null,
        file: null,
        folder: null,
        stage: null,
    };
}

function resolveFeedbackLifecycle(currentPath) {
    if (!currentPath || !fs.existsSync(currentPath)) return null;

    try {
        const { parseFrontMatter } = require('./utils');
        const parsed = parseFrontMatter(fs.readFileSync(currentPath, 'utf8'));
        return normalizeFeedbackStatus(parsed.data.status) || 'inbox';
    } catch (_) {
        return 'inbox';
    }
}

function getFeedbackExpectedPath(repoPath, currentPath, lifecycle) {
    const folder = FEEDBACK_STATUS_TO_FOLDER[normalizeFeedbackStatus(lifecycle) || 'inbox'];
    if (!folder || !currentPath) return null;
    return path.join(getFeedbackRoot(repoPath), folder, path.basename(currentPath));
}

function reconcileEntitySpec(repoPath, entityType, entityId, options = {}) {
    const normalizedEntityType = entityType === 'research'
        ? 'research'
        : (entityType === 'feedback' ? 'feedback' : 'feature');
    const normalizedId = normalizeEntityId(entityId);

    if (normalizedEntityType === 'feedback') {
        const visibleSpec = resolveFeedbackVisibleSpec(repoPath, entityId);
        const currentPath = visibleSpec.path;
        const lifecycle = resolveFeedbackLifecycle(currentPath);
        const expectedPath = getFeedbackExpectedPath(repoPath, currentPath, lifecycle);

        if (!currentPath || !lifecycle) {
            return {
                entityType: normalizedEntityType,
                entityId: normalizedId,
                snapshot: null,
                lifecycle: lifecycle || null,
                visibleStage: lifecycle || visibleSpec.stage || null,
                currentPath: currentPath || null,
                expectedPath: expectedPath || null,
                driftDetected: false,
                moved: false,
                skipped: 'missing-visible-spec',
            };
        }

        return reconcileResolvedSpec(repoPath, {
            entityType: normalizedEntityType,
            entityId: normalizedId,
            snapshot: null,
            lifecycle,
            currentPath,
            expectedPath,
            visibleStage: lifecycle,
            placeholderTargetAllowed: false,
            logger: options.logger,
            dryRun: options.dryRun,
        });
    }

    const snapshot = options.snapshot === undefined
        ? readWorkflowSnapshot(repoPath, normalizedEntityType, entityId)
        : options.snapshot;
    const lifecycle = resolveLifecycle(snapshot);

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
    const expectedPath = getSpecPathForEntity(repoPath, normalizedEntityType, normalizedId, lifecycle, { snapshot });
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

    return reconcileResolvedSpec(repoPath, {
        entityType: normalizedEntityType,
        entityId: normalizedId,
        snapshot,
        lifecycle,
        currentPath,
        expectedPath,
        visibleStage: expectedStage || visibleSpec.stage || null,
        placeholderTargetAllowed: true,
        logger: options.logger,
        dryRun: options.dryRun,
    });
}

function reconcileResolvedSpec(repoPath, options) {
    const {
        entityType,
        entityId,
        snapshot,
        lifecycle,
        currentPath,
        expectedPath,
        visibleStage,
        placeholderTargetAllowed,
        logger,
        dryRun,
    } = options;

    // Guard: never move to anything outside <repoPath>/docs/specs/. The engine
    // path helper can legitimately return a fallback path under .aigon/workflows/
    // when a lifecycle state has no visible dir mapping — that path is internal
    // workflow state, not a user-facing spec location. Moving a spec file into
    // it would effectively delete the spec from the user's view.
    const docsRoot = path.join(repoPath, 'docs', 'specs') + path.sep;
    const expectedDir = path.dirname(expectedPath);
    if (!(expectedDir + path.sep).startsWith(docsRoot)) {
        return {
            entityType,
            entityId,
            snapshot,
            lifecycle,
            visibleStage,
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
            entityType,
            entityId,
            snapshot,
            lifecycle,
            visibleStage,
            currentPath,
            expectedPath: targetPath,
            driftDetected: false,
            moved: false,
            skipped: null,
        };
    }

    if (dryRun) {
        return {
            entityType,
            entityId,
            snapshot,
            lifecycle,
            visibleStage,
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
            if (placeholderTargetAllowed && featureSpecResolver.isPlaceholderSpecPath(targetPath)) {
                fs.unlinkSync(targetPath);
            } else {
                const warning = `⚠️  Could not reconcile ${entityType} ${entityId} spec path because destination already exists: ${toRelativeRepoPath(repoPath, targetPath)}`;
                if (logger && typeof logger.warn === 'function') {
                    logger.warn(warning);
                } else {
                    console.warn(warning);
                }
                return {
                    entityType,
                    entityId,
                    snapshot,
                    lifecycle,
                    visibleStage,
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
        if (err && err.code === 'ENOENT' && !fs.existsSync(currentPath) && fs.existsSync(targetPath)) {
            return {
                entityType,
                entityId,
                snapshot,
                lifecycle,
                visibleStage,
                currentPath: targetPath,
                previousPath: currentPath,
                expectedPath: targetPath,
                driftDetected: false,
                moved: false,
                skipped: null,
            };
        }
        const warning = `⚠️  Could not reconcile ${entityType} ${entityId} spec path (${toRelativeRepoPath(repoPath, currentPath)} -> ${toRelativeRepoPath(repoPath, targetPath)}): ${err.message}`;
        if (logger && typeof logger.warn === 'function') {
            logger.warn(warning);
        } else {
            console.warn(warning);
        }
        return {
            entityType,
            entityId,
            snapshot,
            lifecycle,
            visibleStage,
            currentPath,
            expectedPath: targetPath,
            driftDetected: true,
            moved: false,
            skipped: 'rename-failed',
            error: err.message,
        };
    }

    const warning = `⚠️  Reconciled ${entityType} ${entityId} spec path: ${toRelativeRepoPath(repoPath, currentPath)} -> ${toRelativeRepoPath(repoPath, targetPath)}`;
    if (logger && typeof logger.warn === 'function') {
        logger.warn(warning);
    } else {
        console.warn(warning);
    }

    return {
        entityType,
        entityId,
        snapshot,
        lifecycle,
        visibleStage,
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
