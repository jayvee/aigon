'use strict';

/**
 * Path computation for workflow state files.
 *
 * Ported from aigon-next/src/workflow/paths.ts.
 * Uses `.aigon/workflows/` (Aigon convention) instead of `.a2/`.
 */

const path = require('path');
const fs = require('fs');

const LIFECYCLE_TO_FEATURE_DIR = Object.freeze({
  inbox: '01-inbox',
  backlog: '02-backlog',
  implementing: '03-in-progress',
  reviewing: '03-in-progress',
  evaluating: '04-in-evaluation',
  ready_for_review: '04-in-evaluation',
  closing: '04-in-evaluation',
  done: '05-done',
  paused: '06-paused',
});

const LIFECYCLE_TO_RESEARCH_DIR = Object.freeze({
  inbox: '01-inbox',
  backlog: '02-backlog',
  implementing: '03-in-progress',
  reviewing: '03-in-progress',
  evaluating: '04-in-evaluation',
  closing: '04-in-evaluation',
  done: '05-done',
  paused: '06-paused',
});

function getEntityConfig(entityType) {
  if (entityType === 'research') {
    return {
      workflowDir: 'research',
      docsDir: 'research-topics',
      prefix: 'research',
      lifecycleDirMap: LIFECYCLE_TO_RESEARCH_DIR,
    };
  }
  return {
    workflowDir: 'features',
    docsDir: 'features',
    prefix: 'feature',
    lifecycleDirMap: LIFECYCLE_TO_FEATURE_DIR,
  };
}

function formatSpecResolutionError(entityType, entityId, reason, details) {
  return `Spec path resolution failed for ${entityType}#${entityId}: ${reason}. ${details}`;
}

function getUnknownLifecycleDetails(entityType, lifecycle) {
  const mapName = entityType === 'research' ? 'LIFECYCLE_TO_RESEARCH_DIR' : 'LIFECYCLE_TO_FEATURE_DIR';
  return `lifecycle=${JSON.stringify(lifecycle)}; add it to ${mapName} in lib/workflow-core/paths.js`;
}

function listVisibleSpecMatches(visibleRoot, prefix) {
  const stageDirs = fs.readdirSync(visibleRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(visibleRoot, entry.name));
  const matches = [];

  for (const dir of stageDirs) {
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(prefix) && file.endsWith('.md')) {
        matches.push({ file, path: path.join(dir, file) });
      }
    }
  }

  return matches;
}

function normalizeSnapshotSpecPath(repoPath, snapshotPath) {
  if (!snapshotPath) return null;
  return path.isAbsolute(snapshotPath) ? snapshotPath : path.resolve(repoPath, snapshotPath);
}

function getEntityRoot(repoPath, entityType, entityId) {
  const cfg = getEntityConfig(entityType);
  return path.join(repoPath, '.aigon', 'workflows', cfg.workflowDir, entityId);
}

function getFeatureRoot(repoPath, featureId) {
  return getEntityRoot(repoPath, 'feature', featureId);
}

function getEventsPathForEntity(repoPath, entityType, entityId) {
  return path.join(getEntityRoot(repoPath, entityType, entityId), 'events.jsonl');
}

function getEventsPath(repoPath, featureId) {
  return getEventsPathForEntity(repoPath, 'feature', featureId);
}

function getSnapshotPathForEntity(repoPath, entityType, entityId) {
  return path.join(getEntityRoot(repoPath, entityType, entityId), 'snapshot.json');
}

function getSnapshotPath(repoPath, featureId) {
  return getSnapshotPathForEntity(repoPath, 'feature', featureId);
}

function getLockPathForEntity(repoPath, entityType, entityId) {
  return path.join(getEntityRoot(repoPath, entityType, entityId), 'lock');
}

function getLockPath(repoPath, featureId) {
  return getLockPathForEntity(repoPath, 'feature', featureId);
}

function getEntityWorkflowPaths(repoPath, entityType, entityId) {
  return {
    root: getEntityRoot(repoPath, entityType, entityId),
    eventsPath: getEventsPathForEntity(repoPath, entityType, entityId),
    snapshotPath: getSnapshotPathForEntity(repoPath, entityType, entityId),
    lockPath: getLockPathForEntity(repoPath, entityType, entityId),
  };
}

function getSpecStateDirForEntity(repoPath, entityType, lifecycle) {
  const cfg = getEntityConfig(entityType);
  const visibleDir = cfg.lifecycleDirMap[lifecycle];
  if (visibleDir) {
    return path.join(repoPath, 'docs', 'specs', cfg.docsDir, visibleDir);
  }
  throw new Error(
    formatSpecResolutionError(
      entityType,
      'unknown',
      'unknown-lifecycle',
      getUnknownLifecycleDetails(entityType, lifecycle),
    ),
  );
}

function getSpecPathForEntity(repoPath, entityType, entityId, lifecycle, options = {}) {
  const cfg = getEntityConfig(entityType);
  const specDir = getSpecStateDirForEntity(repoPath, entityType, lifecycle);
  const prefix = `${cfg.prefix}-${String(entityId).padStart(2, '0')}-`;
  const visibleRoot = path.join(repoPath, 'docs', 'specs', cfg.docsDir);
  const snapshotPath = normalizeSnapshotSpecPath(repoPath, options.snapshot && options.snapshot.specPath);
  let matches;

  try {
    matches = listVisibleSpecMatches(visibleRoot, prefix);
  } catch (_) {
    // Fall through to the padded-id fallback when repo layout is unavailable.
    matches = [];
  }

  if (matches.length === 1) {
    return path.join(specDir, matches[0].file);
  }

  if (matches.length > 1) {
    if (!snapshotPath) {
      throw new Error(
        formatSpecResolutionError(
          entityType,
          entityId,
          'duplicate-matches-no-snapshot-hint',
          `matches=${matches.map((match) => path.relative(repoPath, match.path).replace(/\\/g, '/')).join(', ')}`,
        ),
      );
    }

    const hintedMatch = matches.find((match) => match.path === snapshotPath);
    if (!hintedMatch) {
      throw new Error(
        formatSpecResolutionError(
          entityType,
          entityId,
          'duplicate-matches-snapshot-mismatch',
          `snapshotSpecPath=${JSON.stringify(snapshotPath)}; matches=${matches.map((match) => path.relative(repoPath, match.path).replace(/\\/g, '/')).join(', ')}`,
        ),
      );
    }

    return path.join(specDir, hintedMatch.file);
  }

  return path.join(specDir, `${String(entityId).padStart(2, '0')}.md`);
}

function getSpecStateDir(repoPath, lifecycle) {
  return getSpecStateDirForEntity(repoPath, 'feature', lifecycle);
}

function getSpecPath(repoPath, featureId, lifecycle, options = {}) {
  return getSpecPathForEntity(repoPath, 'feature', featureId, lifecycle, options);
}

module.exports = {
  getEntityRoot,
  getEventsPathForEntity,
  getSnapshotPathForEntity,
  getLockPathForEntity,
  getEntityWorkflowPaths,
  getSpecStateDirForEntity,
  getSpecPathForEntity,
  getFeatureRoot,
  getEventsPath,
  getSnapshotPath,
  getLockPath,
  getSpecStateDir,
  getSpecPath,
  LIFECYCLE_TO_FEATURE_DIR,
  LIFECYCLE_TO_RESEARCH_DIR,
};
