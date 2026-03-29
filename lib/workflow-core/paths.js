'use strict';

/**
 * Path computation for workflow state files.
 *
 * Ported from aigon-next/src/workflow/paths.ts.
 * Uses `.aigon/workflows/` (Aigon convention) instead of `.a2/`.
 */

const path = require('path');

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
  return path.join(repoPath, '.aigon', 'workflows', 'specs', lifecycle);
}

function getSpecPath(repoPath, featureId, lifecycle) {
  return path.join(getSpecStateDir(repoPath, lifecycle), `${featureId}.md`);
}

module.exports = {
  getFeatureRoot,
  getEventsPath,
  getSnapshotPath,
  getLockPath,
  getSpecStateDir,
  getSpecPath,
};
