'use strict';

const fs = require('fs');
const path = require('path');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getSpecPathForEntity, STAGE_FOLDERS } = require('./workflow-core/paths');
const { tryResolveSpecIdentity } = require('./spec-identity');

const VISIBLE_STAGE_DIRS = Object.freeze([
    { dir: STAGE_FOLDERS.INBOX, stage: 'inbox' },
    { dir: STAGE_FOLDERS.BACKLOG, stage: 'backlog' },
    { dir: STAGE_FOLDERS.IN_PROGRESS, stage: 'in-progress' },
    { dir: STAGE_FOLDERS.IN_EVALUATION, stage: 'in-evaluation' },
    { dir: STAGE_FOLDERS.DONE, stage: 'done' },
    { dir: STAGE_FOLDERS.PAUSED, stage: 'paused' },
]);

const PLACEHOLDER_MARKER = 'Spec created by workflow-core.';

const ENTITY_CONFIG = Object.freeze({
    feature: {
        prefix: 'feature',
        docsDir: path.join('docs', 'specs', 'features'),
        snapshotReader: (repoPath, entityId) => workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, entityId),
    },
    research: {
        prefix: 'research',
        docsDir: path.join('docs', 'specs', 'research-topics'),
        snapshotReader: (repoPath, entityId) => workflowSnapshotAdapter.readWorkflowSnapshotSync(repoPath, 'research', entityId),
    },
});

function getEntityConfig(entityType) {
    return ENTITY_CONFIG[entityType] || ENTITY_CONFIG.feature;
}

function getEntityIdCandidates(entityId) {
  const raw = String(entityId);
  const padded = /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw;
  const unpadded = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
  return [...new Set([padded, unpadded, raw].filter(Boolean))];
}

/**
 * Resolve CLI/user input to the workflow entity id and scanner-friendly keys.
 * Strips a leading "feature-" / "research-" when the remainder is an unprioritised
 * slug (not feature-NN-… ID-prefixed spec names).
 */
function normalizeEntityIdForLookup(entityType, entityId) {
  const raw = String(entityId || '');
  const resolved = tryResolveSpecIdentity(raw, { kind: entityType });
  if (resolved) {
    return resolved.numericId;
  }
  if (entityType === 'feature' && raw.startsWith('feature-')) {
    const rest = raw.slice('feature-'.length);
    if (/^\d+-.+/.test(rest) || /^\d+$/.test(rest)) {
      return entityId;
    }
    return rest;
  }
  if (entityType === 'research' && raw.startsWith('research-')) {
    const rest = raw.slice('research-'.length);
    if (/^\d+-.+/.test(rest) || /^\d+$/.test(rest)) {
      return entityId;
    }
    return rest;
  }
  return entityId;
}

function safeReadDir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch (_) {
        return [];
    }
}

function pathExists(targetPath) {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch (_) {
        return false;
    }
}

function isPlaceholderSpecContent(content) {
    return String(content || '').includes(PLACEHOLDER_MARKER);
}

function isPlaceholderSpecPath(specPath) {
    if (!specPath || !pathExists(specPath)) return false;
    try {
        return isPlaceholderSpecContent(fs.readFileSync(specPath, 'utf8'));
    } catch (_) {
        return false;
    }
}

function listVisibleEntitySpecs(repoPath, entityType, entityId) {
    const specIndex = arguments[3] || null;
    const cfg = getEntityConfig(entityType);
    const idForScan = normalizeEntityIdForLookup(entityType, entityId);
    const prefixes = getEntityIdCandidates(idForScan).map(candidate => `${cfg.prefix}-${candidate}-`);
    const visibleRoot = path.join(repoPath, cfg.docsDir);
    const matches = [];

    if (entityType === 'feature' && specIndex && Array.isArray(specIndex.entries)) {
        specIndex.entries.forEach(entry => {
            if (!entry || !entry.file) return;
            const idMatches = entry.id && prefixes.some(prefix => entry.file.startsWith(prefix));
            const slugMatches = prefixes.some(prefix => `${cfg.prefix}-${entry.slug || ''}.md`.startsWith(prefix));
            if (!idMatches && !slugMatches) return;
            matches.push({
                file: entry.file,
                path: entry.fullPath,
                stage: entry.stage,
                isPlaceholder: isPlaceholderSpecPath(entry.fullPath),
            });
        });
    } else {
    VISIBLE_STAGE_DIRS.forEach(({ dir, stage }) => {
        const fullDir = path.join(visibleRoot, dir);
        safeReadDir(fullDir)
            .filter(file => prefixes.some(prefix => file.startsWith(prefix)) && file.endsWith('.md'))
            .forEach(file => {
                const fullPath = path.join(fullDir, file);
                matches.push({
                    file,
                    path: fullPath,
                    stage,
                    isPlaceholder: isPlaceholderSpecPath(fullPath),
                });
            });
    });
    }

    // Unprioritised slug files: feature-<slug>.md (no feature-NN- segment) — the
    // "prefix + dash" filter above only matches feature-<id>-title.md
    for (const candidate of getEntityIdCandidates(idForScan)) {
        if (/^\d+$/.test(String(candidate))) {
            continue;
        }
        const exactName = `${cfg.prefix}-${candidate}.md`;
        for (const { dir, stage } of VISIBLE_STAGE_DIRS) {
            const fullPath = path.join(visibleRoot, dir, exactName);
            if (!pathExists(fullPath) || isPlaceholderSpecPath(fullPath)) {
                continue;
            }
            if (matches.some(m => m.path === fullPath)) {
                continue;
            }
            matches.push({
                file: exactName,
                path: fullPath,
                stage,
                isPlaceholder: false,
            });
        }
    }

    return matches;
}

function listVisibleFeatureSpecs(repoPath, featureId) {
    return listVisibleEntitySpecs(repoPath, 'feature', featureId);
}

function getExpectedStageFromSnapshot(snapshot) {
    return snapshot ? workflowSnapshotAdapter.snapshotToStage(snapshot) : null;
}

function getExpectedVisiblePath(repoPath, entityType, entityId, snapshot) {
    const lifecycle = snapshot && (snapshot.lifecycle || snapshot.currentSpecState);
    if (!lifecycle) return null;
    return getSpecPathForEntity(repoPath, entityType, entityId, lifecycle, { snapshot });
}

function rankCandidate(candidate, expectedPath) {
    const matchesExpected = expectedPath && candidate.path === expectedPath;
    if (!candidate.isPlaceholder && matchesExpected) return 0;
    if (!candidate.isPlaceholder) return 1;
    if (matchesExpected) return 2;
    return 3;
}

function readSnapshot(repoPath, entityType, entityId) {
    return getEntityConfig(entityType).snapshotReader(repoPath, entityId);
}

function buildResolvedEntity(entityType, entityId, details) {
    const key = entityType === 'research' ? 'researchId' : 'featureId';
    return {
        [key]: entityId,
        entityId,
        ...details,
    };
}

/**
 * Locate the canonical `00-specs` file for an entity, if one exists. Symlinks
 * are excluded by the layout module via `lstat`. Returns null when absent.
 * Lazy-required to avoid a load cycle with lib/spec-layout.js.
 */
function findCanonicalEntitySpec(repoPath, entityType, idCandidates) {
    let specLayout;
    try {
        specLayout = require('./spec-layout');
    } catch (_) {
        return null;
    }
    for (const candidate of idCandidates) {
        const canonicalPath = specLayout.findCanonicalSpecFile(repoPath, entityType, candidate);
        if (canonicalPath) return canonicalPath;
    }
    return null;
}

function resolveEntitySpec(repoPath, entityType, entityId, options = {}) {
  const normalizedEntityType = entityType === 'research' ? 'research' : 'feature';
  const normalizedId = normalizeEntityIdForLookup(normalizedEntityType, entityId);
  const idCandidates = getEntityIdCandidates(normalizedId);

    // Canonical `00-specs` file wins whenever it exists (F668). The resolver
    // only falls back to legacy stage discovery when there is no canonical
    // file, matching the compatibility contract: a legacy real file is
    // discovered only when no canonical file exists.
    const canonicalPath = findCanonicalEntitySpec(repoPath, normalizedEntityType, idCandidates);
    if (canonicalPath && !isPlaceholderSpecPath(canonicalPath)) {
        const canonicalSnapshot = options.snapshot === undefined
            ? idCandidates.map(candidate => readSnapshot(repoPath, normalizedEntityType, candidate)).find(Boolean) || null
            : options.snapshot;
        return buildResolvedEntity(normalizedEntityType, idCandidates[0], {
            path: canonicalPath,
            file: path.basename(canonicalPath),
            stage: getExpectedStageFromSnapshot(canonicalSnapshot),
            expectedStage: getExpectedStageFromSnapshot(canonicalSnapshot),
            isPlaceholder: false,
            source: 'canonical',
            snapshot: canonicalSnapshot,
        });
    }
    const snapshot = options.snapshot === undefined
        ? idCandidates.map(candidate => readSnapshot(repoPath, normalizedEntityType, candidate)).find(Boolean) || null
        : options.snapshot;
  const matches = listVisibleEntitySpecs(repoPath, normalizedEntityType, normalizedId, options.specIndex || null);
  const expectedPath = getExpectedVisiblePath(repoPath, normalizedEntityType, normalizedId, snapshot);
  const expectedStage = getExpectedStageFromSnapshot(snapshot);

  const ranked = matches
    .slice()
    .sort((left, right) => rankCandidate(left, expectedPath) - rankCandidate(right, expectedPath));
  const selected = ranked[0] || null;
  const resolvedEntityId = getEntityIdCandidates(normalizedId)[0];

    if (selected) {
        return buildResolvedEntity(normalizedEntityType, resolvedEntityId, {
            path: selected.path,
            file: selected.file,
            stage: selected.stage,
            expectedStage,
            isPlaceholder: selected.isPlaceholder,
            source: selected.path === expectedPath ? 'workflow-visible' : 'visible-fallback',
            snapshot,
        });
    }

    if (expectedPath) {
        return buildResolvedEntity(normalizedEntityType, resolvedEntityId, {
            path: expectedPath,
            file: path.basename(expectedPath),
            stage: expectedStage,
            expectedStage,
            isPlaceholder: false,
            source: 'workflow-expected',
            snapshot,
        });
    }

    return buildResolvedEntity(normalizedEntityType, resolvedEntityId, {
        path: null,
        file: null,
        stage: null,
        expectedStage: null,
        isPlaceholder: false,
        source: 'missing',
        snapshot,
    });
}

function resolveFeatureSpec(repoPath, featureId, options = {}) {
    return resolveEntitySpec(repoPath, 'feature', featureId, options);
}

function resolveResearchSpec(repoPath, researchId, options = {}) {
    return resolveEntitySpec(repoPath, 'research', researchId, options);
}

function repoHasVisibleEntitySpec(repoPath, entityType, entityId) {
    return listVisibleEntitySpecs(repoPath, entityType, entityId).length > 0;
}

module.exports = {
  PLACEHOLDER_MARKER,
  VISIBLE_STAGE_DIRS,
  isPlaceholderSpecContent,
  isPlaceholderSpecPath,
  listVisibleEntitySpecs,
  listVisibleFeatureSpecs,
  repoHasVisibleEntitySpec,
  normalizeEntityIdForLookup,
  resolveEntitySpec,
  resolveFeatureSpec,
  resolveResearchSpec,
};
