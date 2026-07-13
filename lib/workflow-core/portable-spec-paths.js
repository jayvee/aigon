'use strict';

const fs = require('fs');
const path = require('path');
const {
  getSpecPathForEntity,
  listVisibleSpecMatches,
  CANONICAL_STAGE_DIRS,
} = require('./paths');

const DOCS_SPECS_MARKER = '/docs/specs/';

function toPortableSpecPath(repoPath, filePath) {
  if (!filePath) return filePath;
  const resolved = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(repoPath, filePath);
  const relative = path.relative(repoPath, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return filePath;
  }
  return relative.split(path.sep).join('/');
}

function extractDocsSpecsSuffix(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  const normalized = storedPath.replace(/\\/g, '/');
  const idx = normalized.indexOf(DOCS_SPECS_MARKER);
  if (idx === -1) return null;
  return normalized.slice(idx + 1);
}

function resolvePortableSpecPath(repoPath, storedPath) {
  if (!storedPath) return null;
  if (!path.isAbsolute(storedPath)) {
    return path.resolve(repoPath, storedPath);
  }
  const normalized = path.normalize(storedPath);
  if (normalized.startsWith(path.normalize(repoPath + path.sep))) {
    return normalized;
  }
  const suffix = extractDocsSpecsSuffix(storedPath);
  if (suffix) {
    return path.resolve(repoPath, suffix);
  }
  return null;
}

function getEntityDocsRoot(repoPath, entityType) {
  const docsDir = entityType === 'research' ? 'research-topics' : 'features';
  return path.join(repoPath, 'docs', 'specs', docsDir);
}

function getEntityPrefix(entityType) {
  return entityType === 'research' ? 'research' : 'feature';
}

function findVisibleSpecForEntity(repoPath, entityType, entityId, options = {}) {
  const prefix = getEntityPrefix(entityType);
  const visibleRoot = getEntityDocsRoot(repoPath, entityType);
  const idStr = String(entityId);
  const matches = listVisibleSpecMatches(visibleRoot, `${prefix}-${idStr.padStart(2, '0')}-`);
  if (matches.length === 1) {
    return matches[0].path;
  }
  if (matches.length > 1 && options.lifecycle) {
    try {
      const expectedDir = path.dirname(
        getSpecPathForEntity(repoPath, entityType, entityId, options.lifecycle, options),
      );
      const inExpected = matches.find((match) => path.dirname(match.path) === expectedDir);
      if (inExpected) return inExpected.path;
    } catch (_) {
      // Fall through to first non-placeholder match.
    }
    return matches[0].path;
  }
  if (matches.length > 0) {
    return matches[0].path;
  }

  const priorSlug = options.priorSlug || (options.snapshot && options.snapshot.priorSlug);
  if (priorSlug && !/^\d+$/.test(String(priorSlug))) {
    const slugName = `${prefix}-${priorSlug}.md`;
    for (const stageDir of CANONICAL_STAGE_DIRS) {
      const candidate = path.join(visibleRoot, stageDir, slugName);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (_) {
        // ignore fs errors
      }
    }
  }

  return null;
}

function buildMoveSpecPayload(repoPath, payload) {
  const next = { ...payload };
  if (payload.fromPath) {
    next.fromPath = toPortableSpecPath(repoPath, payload.fromPath);
  }
  if (payload.toPath) {
    next.toPath = toPortableSpecPath(repoPath, payload.toPath);
  }
  return next;
}

function resolveMoveSpecPayload(repoPath, entityType, entityId, payload, options = {}) {
  const resolved = { ...payload };
  let fromPath = resolvePortableSpecPath(repoPath, payload.fromPath);
  let toPath = resolvePortableSpecPath(repoPath, payload.toPath);

  if (payload.toLifecycle) {
    try {
      toPath = getSpecPathForEntity(repoPath, entityType, entityId, payload.toLifecycle, options);
    } catch (_) {
      // Keep resolved portable target when lifecycle mapping is unavailable.
    }
  }

  if (!fromPath || !fs.existsSync(fromPath)) {
    const discovered = findVisibleSpecForEntity(repoPath, entityType, entityId, {
      ...options,
      lifecycle: payload.fromLifecycle || (options.snapshot && options.snapshot.currentSpecState),
      priorSlug: payload.priorSlug || (options.snapshot && options.snapshot.priorSlug),
    });
    if (discovered) {
      fromPath = discovered;
    }
  }

  if (fromPath && toPath) {
    const fromBase = path.basename(fromPath);
    const toBase = path.basename(toPath);
    const toLooksPlaceholder = /^\d+\.md$/.test(toBase) || toBase === `${String(entityId).padStart(2, '0')}.md`;
    if (toLooksPlaceholder && fromBase && fromBase !== toBase) {
      toPath = path.join(path.dirname(toPath), fromBase);
    }
  }

  resolved.fromPath = fromPath || payload.fromPath;
  resolved.toPath = toPath || payload.toPath;
  return resolved;
}

module.exports = {
  toPortableSpecPath,
  resolvePortableSpecPath,
  extractDocsSpecsSuffix,
  findVisibleSpecForEntity,
  buildMoveSpecPayload,
  resolveMoveSpecPayload,
};
