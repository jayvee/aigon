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
  backlog: '02-backlog',
  implementing: '03-in-progress',
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

function getSpecStateDirForEntity(repoPath, entityType, lifecycle) {
  const cfg = getEntityConfig(entityType);
  const visibleDir = cfg.lifecycleDirMap[lifecycle];
  if (visibleDir) {
    return path.join(repoPath, 'docs', 'specs', cfg.docsDir, visibleDir);
  }
  return path.join(repoPath, '.aigon', 'workflows', 'specs', lifecycle);
}

function getSpecPathForEntity(repoPath, entityType, entityId, lifecycle) {
  const cfg = getEntityConfig(entityType);
  const specDir = getSpecStateDirForEntity(repoPath, entityType, lifecycle);
  const prefix = `${cfg.prefix}-${String(entityId).padStart(2, '0')}-`;
  const visibleRoot = path.join(repoPath, 'docs', 'specs', cfg.docsDir);

  try {
    const stageDirs = fs.readdirSync(visibleRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(visibleRoot, entry.name));
    for (const dir of stageDirs) {
      const match = fs.readdirSync(dir).find(file => file.startsWith(prefix) && file.endsWith('.md'));
      if (match) {
        return path.join(specDir, match);
      }
    }
  } catch (_) {
    // Fall through to workflow-internal fallback when repo layout is unavailable.
  }

  return path.join(specDir, `${String(entityId).padStart(2, '0')}.md`);
}

function getSpecStateDir(repoPath, lifecycle) {
  return getSpecStateDirForEntity(repoPath, 'feature', lifecycle);
}

function getSpecPath(repoPath, featureId, lifecycle) {
  return getSpecPathForEntity(repoPath, 'feature', featureId, lifecycle);
}

module.exports = {
  getEntityRoot,
  getEventsPathForEntity,
  getSnapshotPathForEntity,
  getLockPathForEntity,
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
