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

function getFeatureRoot(repoPath, featureId) {
  return path.join(repoPath, '.aigon', 'workflows', 'features', featureId);
}

function getEventsPath(repoPath, featureId) {
  return path.join(getFeatureRoot(repoPath, featureId), 'events.jsonl');
}

function getSnapshotPath(repoPath, featureId) {
  return path.join(getFeatureRoot(repoPath, featureId), 'snapshot.json');
}

function getLockPath(repoPath, featureId) {
  return path.join(getFeatureRoot(repoPath, featureId), 'lock');
}

function getSpecStateDir(repoPath, lifecycle) {
  const visibleDir = LIFECYCLE_TO_FEATURE_DIR[lifecycle];
  if (visibleDir) {
    return path.join(repoPath, 'docs', 'specs', 'features', visibleDir);
  }
  return path.join(repoPath, '.aigon', 'workflows', 'specs', lifecycle);
}

function getSpecPath(repoPath, featureId, lifecycle) {
  const specDir = getSpecStateDir(repoPath, lifecycle);
  const featurePrefix = `feature-${String(featureId).padStart(2, '0')}-`;
  const visibleRoot = path.join(repoPath, 'docs', 'specs', 'features');

  try {
    const stageDirs = fs.readdirSync(visibleRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(visibleRoot, entry.name));
    for (const dir of stageDirs) {
      const match = fs.readdirSync(dir).find(file => file.startsWith(featurePrefix) && file.endsWith('.md'));
      if (match) {
        return path.join(specDir, match);
      }
    }
  } catch (_) {
    // Fall through to legacy workflow-internal path if repo layout is unavailable.
  }

  return path.join(specDir, `${String(featureId).padStart(2, '0')}.md`);
}

module.exports = {
  getFeatureRoot,
  getEventsPath,
  getSnapshotPath,
  getLockPath,
  getSpecStateDir,
  getSpecPath,
  LIFECYCLE_TO_FEATURE_DIR,
};
