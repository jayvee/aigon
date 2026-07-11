'use strict';

/**
 * Shared stable-layout lifecycle helpers.
 *
 * In `specLayout: stable`, workflow state is canonical and lifecycle folders
 * are a generated symlink view. Legacy layout keeps the older tracked-file
 * move behaviour for the compatibility window.
 */

function isStableSpecLayout(repoPath) {
  try {
    return require('./spec-layout-core').isStableLayout(repoPath);
  } catch (_) {
    return false;
  }
}

function shouldMoveSpecFiles(repoPath) {
  return !isStableSpecLayout(repoPath);
}

function findCanonicalSpecPath(repoPath, entityType, entityId) {
  if (!isStableSpecLayout(repoPath)) return null;
  try {
    return require('./spec-layout-core').findCanonicalSpecFile(repoPath, entityType, entityId);
  } catch (_) {
    return null;
  }
}

function filterMoveSpecEffects(repoPath, effects) {
  if (shouldMoveSpecFiles(repoPath)) return effects;
  return (effects || []).filter((effect) => effect && effect.type !== 'move_spec');
}

function refreshLifecycleView(repoPath, options = {}) {
  if (!isStableSpecLayout(repoPath)) {
    return { skipped: true, reason: 'legacy-layout' };
  }
  const warn = typeof options.warn === 'function' ? options.warn : null;
  try {
    const result = require('./spec-view').refreshView(repoPath);
    if (result && Array.isArray(result.blocked) && result.blocked.length > 0 && warn) {
      warn(`⚠️  Lifecycle view has ${result.blocked.length} repairable issue(s) — run: aigon spec-view refresh`);
    }
    return result;
  } catch (error) {
    if (warn) warn(`⚠️  Lifecycle view refresh failed (${error.message}) — run: aigon spec-view refresh`);
    return { failed: true, error };
  }
}

module.exports = {
  isStableSpecLayout,
  shouldMoveSpecFiles,
  findCanonicalSpecPath,
  filterMoveSpecEffects,
  refreshLifecycleView,
};
