'use strict';

/**
 * Path computation for workflow state files.
 *
 * Ported from aigon-next/src/workflow/paths.ts.
 * Uses `.aigon/workflows/` (Aigon convention) instead of `.a2/`.
 */

const path = require('path');
const fs = require('fs');

// Canonical stage folder names. A non-canonical sibling directory (e.g.
// a typo or a stale `04-done` from before the 05-done rename) is invisible
// to the resolver — this structurally prevents the duplicate-match bug class
// hit by the jvbot research-02 incident on 2026-04-20.
// Named constants for the five primary workflow stage folders.
// Import these instead of inlining the string literals.
const STAGE_FOLDERS = Object.freeze({
  INBOX: '01-inbox',
  BACKLOG: '02-backlog',
  IN_PROGRESS: '03-in-progress',
  IN_EVALUATION: '04-in-evaluation',
  DONE: '05-done',
  PAUSED: '06-paused',
});

const CANONICAL_STAGE_DIRS = Object.freeze([
  STAGE_FOLDERS.INBOX,
  STAGE_FOLDERS.BACKLOG,
  STAGE_FOLDERS.IN_PROGRESS,
  STAGE_FOLDERS.IN_EVALUATION,
  STAGE_FOLDERS.DONE,
  STAGE_FOLDERS.PAUSED,
]);

const CANONICAL_STAGE_DIR_SET = new Set(CANONICAL_STAGE_DIRS);

const LIFECYCLE_TO_FEATURE_DIR = Object.freeze({
  inbox: STAGE_FOLDERS.INBOX,
  backlog: STAGE_FOLDERS.BACKLOG,
  spec_review_in_progress: STAGE_FOLDERS.BACKLOG,
  spec_review_complete: STAGE_FOLDERS.BACKLOG,
  spec_revision_in_progress: STAGE_FOLDERS.BACKLOG,
  spec_revision_complete: STAGE_FOLDERS.BACKLOG,
  implementing: STAGE_FOLDERS.IN_PROGRESS,
  ready: STAGE_FOLDERS.IN_PROGRESS,
  code_review_in_progress: STAGE_FOLDERS.IN_PROGRESS,
  code_review_complete: STAGE_FOLDERS.IN_PROGRESS,
  code_revision_in_progress: STAGE_FOLDERS.IN_PROGRESS,
  code_revision_complete: STAGE_FOLDERS.IN_PROGRESS,
  close_recovery_in_progress: STAGE_FOLDERS.IN_PROGRESS,
  evaluating: STAGE_FOLDERS.IN_EVALUATION,
  ready_for_review: STAGE_FOLDERS.IN_EVALUATION,
  closing: STAGE_FOLDERS.IN_EVALUATION,
  done: STAGE_FOLDERS.DONE,
  paused: STAGE_FOLDERS.PAUSED,
});

const LIFECYCLE_TO_RESEARCH_DIR = Object.freeze({
  inbox: STAGE_FOLDERS.INBOX,
  backlog: STAGE_FOLDERS.BACKLOG,
  spec_review_in_progress: STAGE_FOLDERS.BACKLOG,
  spec_review_complete: STAGE_FOLDERS.BACKLOG,
  spec_revision_in_progress: STAGE_FOLDERS.BACKLOG,
  spec_revision_complete: STAGE_FOLDERS.BACKLOG,
  implementing: STAGE_FOLDERS.IN_PROGRESS,
  ready: STAGE_FOLDERS.IN_PROGRESS,
  code_review_in_progress: STAGE_FOLDERS.IN_PROGRESS,
  code_review_complete: STAGE_FOLDERS.IN_PROGRESS,
  code_revision_in_progress: STAGE_FOLDERS.IN_PROGRESS,
  code_revision_complete: STAGE_FOLDERS.IN_PROGRESS,
  evaluating: STAGE_FOLDERS.IN_EVALUATION,
  closing: STAGE_FOLDERS.IN_EVALUATION,
  done: STAGE_FOLDERS.DONE,
  paused: STAGE_FOLDERS.PAUSED,
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
  // Stage directories are the canonical set in CANONICAL_STAGE_DIRS.
  // Anything else — including stale folder names like `04-done` / `05-paused`
  // from the pre-rename era, or `logs/` / `evaluations/` siblings — is
  // invisible to the resolver. This kills the duplicate-match bug class
  // structurally (jvbot research-02, 2026-04-20).
  const stageDirs = fs.readdirSync(visibleRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && CANONICAL_STAGE_DIR_SET.has(entry.name))
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
  // Legacy `submitted` snapshots (F501) map to the same folder as the new `ready` lifecycle.
  const normalized = lifecycle === 'submitted' ? 'ready' : lifecycle;
  const visibleDir = cfg.lifecycleDirMap[normalized];
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
    // Same basename in two stage dirs (e.g. 02-backlog and 03-in-progress) can happen
    // after a bad merge, manual copy, or a move that left a stale second path. Prefer
    // the file under the directory for the *current* lifecycle (specDir) so the resolver
    // matches workflow state (F366-class incidents).
    const inExpected = matches.filter((m) => path.dirname(m.path) === specDir);
    if (inExpected.length === 1) {
      return inExpected[0].path;
    }

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

    return hintedMatch.path;
  }

  const idStr = String(entityId);
  const slugBasename = `${cfg.prefix}-${idStr}.md`;
  const slugInStage = path.join(specDir, slugBasename);
  // Slug-keyed entities (inbox) use feature-{slug}.md — padStart prefix scan never matches them.
  if (!/^\d+$/.test(idStr)) {
    try {
      if (fs.existsSync(slugInStage)) {
        return slugInStage;
      }
    } catch (_) {
      // ignore fs errors — fall through to snapshot hint / numeric fallback
    }
  }

  if (snapshotPath) {
    const normalized = normalizeSnapshotSpecPath(repoPath, snapshotPath);
    if (normalized) {
      const normDir = path.dirname(normalized);
      if (normDir === specDir) {
        return normalized;
      }
    }
  }

  return path.join(specDir, `${idStr.padStart(2, '0')}.md`);
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
  STAGE_FOLDERS,
  CANONICAL_STAGE_DIRS,
  LIFECYCLE_TO_FEATURE_DIR,
  LIFECYCLE_TO_RESEARCH_DIR,
};
