'use strict';

const fs = require('fs');
const path = require('path');
const { getCanonicalSpecDirForEntity } = require('./workflow-core/paths');

const LAYOUT_STABLE = 'stable';
const LAYOUT_LEGACY = 'legacy';

const ENTITY_LAYOUT = Object.freeze({
  feature: { prefix: 'feature', docsDir: path.join('docs', 'specs', 'features') },
  research: { prefix: 'research', docsDir: path.join('docs', 'specs', 'research-topics') },
});

function getConfigPath(repoPath) {
  return path.join(repoPath, '.aigon', 'config.json');
}

function readProjectConfig(repoPath) {
  const p = getConfigPath(repoPath);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function getLayoutVersion(repoPath) {
  const cfg = readProjectConfig(repoPath);
  return cfg.specLayout === LAYOUT_STABLE ? LAYOUT_STABLE : LAYOUT_LEGACY;
}

function isStableLayout(repoPath) {
  return getLayoutVersion(repoPath) === LAYOUT_STABLE;
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch (_) {
    return false;
  }
}

function parseSpecFilename(prefix, filename) {
  if (!filename.endsWith('.md')) return null;
  const numbered = filename.match(new RegExp(`^${prefix}-(\\d+)-(.+)\\.md$`));
  if (numbered) {
    return { number: parseInt(numbered[1], 10), paddedId: numbered[1], slug: numbered[2], numbered: true };
  }
  const slugOnly = filename.match(new RegExp(`^${prefix}-(.+)\\.md$`));
  if (slugOnly && !/^\d+$/.test(slugOnly[1])) {
    return { number: null, paddedId: null, slug: slugOnly[1], numbered: false };
  }
  return null;
}

function listCanonicalSpecs(repoPath, entityType) {
  const cfg = ENTITY_LAYOUT[entityType];
  const dir = getCanonicalSpecDirForEntity(repoPath, entityType);
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return out;
  }
  for (const file of entries) {
    const full = path.join(dir, file);
    if (isSymlink(full)) continue;
    const parsed = parseSpecFilename(cfg.prefix, file);
    if (!parsed || !parsed.numbered) continue;
    out.push({ ...parsed, file, path: full });
  }
  return out;
}

function findCanonicalSpecFile(repoPath, entityType, id) {
  const raw = String(id);
  const num = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (num == null) return null;
  const match = listCanonicalSpecs(repoPath, entityType).find(s => s.number === num);
  return match ? match.path : null;
}

module.exports = {
  LAYOUT_STABLE,
  LAYOUT_LEGACY,
  ENTITY_LAYOUT,
  getConfigPath,
  readProjectConfig,
  getLayoutVersion,
  isStableLayout,
  isSymlink,
  parseSpecFilename,
  listCanonicalSpecs,
  findCanonicalSpecFile,
};
