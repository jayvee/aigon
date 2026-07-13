'use strict';

/**
 * Spec layout: canonical `00-specs` storage + explicit legacy→stable migration.
 *
 * Feature 668 (set: stable-spec-layout, member 3). Introduces a
 * lifecycle-independent canonical home for feature/research markdown under
 * `docs/specs/<kind>/00-specs`, records an explicit `specLayout` version in the
 * tracked project config, and provides an explicit, validated migration from
 * the legacy stage-folder storage.
 *
 * Design invariants (see spec ## Technical Approach):
 *   - Canonical files are the only durable content copies once layout=stable.
 *   - Migration NEVER runs from read paths, `aigon apply`, dashboard startup,
 *     or storage polling. It is only reachable via `aigon spec-layout migrate`.
 *   - Symlinks are excluded from canonical discovery by `lstat`, never by
 *     filename heuristics.
 *   - During compatibility the resolver may discover a legacy real file only
 *     when no canonical file exists; both existing is a reported collision.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  STAGE_FOLDERS,
  CANONICAL_STAGE_DIRS,
  CANONICAL_SPEC_DIR,
  getCanonicalSpecDirForEntity,
} = require('./workflow-core/paths');

// Kept in sync with feature-spec-resolver.PLACEHOLDER_MARKER. Inlined (not
// imported) to avoid a require cycle — the resolver lazy-requires this module.
const PLACEHOLDER_MARKER = 'Spec created by workflow-core.';

const LAYOUT_STABLE = 'stable';
const LAYOUT_LEGACY = 'legacy';

const ENTITY_TYPES = Object.freeze(['feature', 'research']);

const ENTITY_LAYOUT = Object.freeze({
  feature: { prefix: 'feature', docsDir: path.join('docs', 'specs', 'features') },
  research: { prefix: 'research', docsDir: path.join('docs', 'specs', 'research-topics') },
});

// Lifecycle folders whose entities still reference legacy spec paths from a
// worktree or an unmerged feature branch. Migrating one of these requires an
// explicit acknowledgement (--yes) because the branch will keep pointing at the
// old stage path until it merges.
const ACTIVE_STAGE_DIRS = Object.freeze([STAGE_FOLDERS.IN_PROGRESS, STAGE_FOLDERS.IN_EVALUATION]);

function runGit(repoPath, args) {
  return execFileSync('git', args, { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] })
    .toString();
}

function tryGit(repoPath, args) {
  try {
    return runGit(repoPath, args);
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layout version (tracked, committed project config)
// ---------------------------------------------------------------------------

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

/**
 * Layout version recorded in the tracked project config. Defaults to `legacy`
 * so an un-migrated repo behaves exactly as before. Storage backend selection
 * (local vs git-branch) never alters the layout.
 */
function getLayoutVersion(repoPath) {
  const cfg = readProjectConfig(repoPath);
  return cfg.specLayout === LAYOUT_STABLE ? LAYOUT_STABLE : LAYOUT_LEGACY;
}

function isStableLayout(repoPath) {
  return getLayoutVersion(repoPath) === LAYOUT_STABLE;
}

function setLayoutVersion(repoPath, version) {
  const p = getConfigPath(repoPath);
  const cfg = readProjectConfig(repoPath);
  cfg.specLayout = version === LAYOUT_STABLE ? LAYOUT_STABLE : LAYOUT_LEGACY;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  return p;
}

/**
 * Decide (and record) the spec layout for a repo at init time.
 *
 * New repositories default to the stable layout (canonical `00-specs`) — the
 * target model shipped by the stable-spec-layout set (F666–F670). We only apply
 * this when it is unambiguously safe:
 *   - the project config has not already recorded an explicit `specLayout`, and
 *   - the repo holds no existing feature/research specs (canonical or legacy).
 *
 * A repo that already contains legacy stage-folder specs is deliberately left on
 * `legacy` so the operator migrates via `aigon spec-layout migrate --stable`; we
 * never silently flip an established repo, which would strand its specs outside
 * `00-specs` and read as a broken mixed layout. Feedback specs are ignored — the
 * layout only governs feature/research storage.
 *
 * Idempotent and safe to call on every `aigon apply`: once `specLayout` is set
 * (either value), this is a no-op.
 *
 * @returns {{applied: boolean, version: 'stable'|'legacy', reason: string}}
 */
function defaultLayoutForNewRepo(repoPath) {
  const cfg = readProjectConfig(repoPath);
  if (cfg.specLayout === LAYOUT_STABLE || cfg.specLayout === LAYOUT_LEGACY) {
    return { applied: false, version: cfg.specLayout, reason: 'explicit' };
  }
  let existing = 0;
  for (const entityType of ENTITY_TYPES) {
    existing += listCanonicalSpecs(repoPath, entityType).length;
    existing += listLegacySpecs(repoPath, entityType).length;
  }
  if (existing > 0) {
    return { applied: false, version: LAYOUT_LEGACY, reason: 'existing-specs' };
  }
  setLayoutVersion(repoPath, LAYOUT_STABLE);
  for (const entityType of ENTITY_TYPES) {
    fs.mkdirSync(getCanonicalSpecDirForEntity(repoPath, entityType), { recursive: true });
  }
  return { applied: true, version: LAYOUT_STABLE, reason: 'new-repo' };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function isPlaceholder(specPath) {
  try {
    return fs.readFileSync(specPath, 'utf8').includes(PLACEHOLDER_MARKER);
  } catch (_) {
    return false;
  }
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

/**
 * Numbered, non-symlink canonical specs under `00-specs`.
 * @returns {Array<{number:number, paddedId:string, slug:string, file:string, path:string}>}
 */
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

/**
 * Real (non-placeholder, non-symlink) legacy specs living in stage folders.
 * `00-specs` is excluded because it is the canonical destination, not a stage.
 */
function listLegacySpecs(repoPath, entityType) {
  const cfg = ENTITY_LAYOUT[entityType];
  const root = path.join(repoPath, cfg.docsDir);
  const out = [];
  for (const stageDir of CANONICAL_STAGE_DIRS) {
    const dir = path.join(root, stageDir);
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const file of entries) {
      const full = path.join(dir, file);
      if (isSymlink(full)) continue;
      const parsed = parseSpecFilename(cfg.prefix, file);
      if (!parsed) continue;
      if (isPlaceholder(full)) continue;
      out.push({ ...parsed, file, path: full, stageDir });
    }
  }
  return out;
}

/**
 * Resolve a canonical spec by identity. Returns null when absent. Never follows
 * a symlink as canonical content.
 */
function findCanonicalSpecFile(repoPath, entityType, id) {
  const raw = String(id);
  const num = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (num == null) return null;
  const match = listCanonicalSpecs(repoPath, entityType).find(s => s.number === num);
  return match ? match.path : null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Read-only layout report. Never mutates files.
 * @returns {{version:string, state:string, canonical:object, legacy:object, blockers:string[]}}
 */
function detectStatus(repoPath) {
  const version = getLayoutVersion(repoPath);
  const canonical = {};
  const legacy = {};
  let canonicalCount = 0;
  let legacyCount = 0;
  for (const entityType of ENTITY_TYPES) {
    canonical[entityType] = listCanonicalSpecs(repoPath, entityType);
    legacy[entityType] = listLegacySpecs(repoPath, entityType);
    canonicalCount += canonical[entityType].length;
    legacyCount += legacy[entityType].length;
  }

  const plan = buildMigrationPlan(repoPath);
  const blockers = plan.blockers;

  let state;
  if (blockers.length > 0) {
    state = 'migration-blocked';
  } else if (version === LAYOUT_STABLE && legacyCount === 0) {
    state = 'stable';
  } else if (canonicalCount > 0 && legacyCount > 0) {
    state = 'mixed';
  } else {
    state = 'legacy';
  }

  return { version, state, canonical, legacy, blockers, warnings: plan.warnings };
}

// ---------------------------------------------------------------------------
// Migration plan / validate / apply
// ---------------------------------------------------------------------------

/**
 * Deterministic migration plan. Pure: performs no writes. Enumerates every
 * legacy stage-folder spec, assigns each a canonical destination, and detects
 * blockers (duplicate ids, destination collisions, dirty files, active
 * worktrees/unmerged branches, paths outside Aigon spec roots).
 *
 * `allocateId` is injected so ID allocation for unnumbered inbox specs routes
 * through the feature-2 create-time reservation contract; tests supply a stub.
 */
function buildMigrationPlan(repoPath, options = {}) {
  const allocateId = typeof options.allocateId === 'function' ? options.allocateId : null;
  const moves = [];
  const blockers = [];
  const warnings = [];
  const needsAck = [];
  const needsId = [];

  // A repo already declared stable with no legacy files left is a no-op plan.
  for (const entityType of ENTITY_TYPES) {
    const cfg = ENTITY_LAYOUT[entityType];
    const canonicalDir = getCanonicalSpecDirForEntity(repoPath, entityType);
    const legacy = listLegacySpecs(repoPath, entityType);
    const byNumber = new Map();

    for (const spec of legacy) {
      let number = spec.number;
      let paddedId = spec.paddedId;
      let allocated = false;
      let aigonKey = null;

      if (number == null) {
        // Unnumbered legacy inbox spec — allocate an ID via the create-time
        // reservation contract (feature 667). Without an allocator (status /
        // dry-run) it is an informational item, not a blocker: the real
        // migrate run always supplies an allocator.
        if (!allocateId) {
          needsId.push(path.relative(repoPath, spec.path));
          continue;
        }
        const reserved = allocateId(entityType);
        number = reserved.number;
        paddedId = reserved.paddedId;
        aigonKey = reserved.key;
        allocated = true;
      }

      // Duplicate specs: two real files claim the same numeric identity.
      if (byNumber.has(number)) {
        blockers.push(
          `duplicate ${entityType} #${number}: ${path.relative(repoPath, byNumber.get(number))} and ${path.relative(repoPath, spec.path)}`,
        );
        continue;
      }
      byNumber.set(number, spec.path);

      const destName = `${cfg.prefix}-${paddedId}-${spec.slug}.md`;
      const dest = path.join(canonicalDir, destName);

      moves.push({
        entityType,
        number,
        paddedId,
        slug: spec.slug,
        from: spec.path,
        to: dest,
        fromRel: path.relative(repoPath, spec.path),
        toRel: path.relative(repoPath, dest),
        stageDir: spec.stageDir,
        allocated,
        aigonKey,
      });
    }
  }

  // Destination collisions: two moves target the same canonical path, or a
  // canonical file already exists that differs from the source.
  const seenDest = new Map();
  for (const move of moves) {
    if (seenDest.has(move.to)) {
      blockers.push(`destination collision: ${move.toRel} claimed by two specs`);
    }
    seenDest.set(move.to, move.from);
    if (fs.existsSync(move.to) && !isSameFileContent(move.from, move.to)) {
      blockers.push(`destination already exists with different content: ${move.toRel}`);
    }
  }

  // Paths outside Aigon-owned spec roots — defence in depth; listLegacySpecs
  // only ever returns paths under the spec roots, but re-assert before moving.
  for (const move of moves) {
    if (!isInsideSpecRoot(repoPath, move.entityType, move.from)) {
      blockers.push(`refusing to move path outside Aigon spec root: ${move.fromRel}`);
    }
  }

  // Dirty relevant files: any source with uncommitted changes blocks the move.
  const dirty = listDirtySpecFiles(repoPath, moves.map(m => m.from));
  for (const rel of dirty) {
    blockers.push(`spec has uncommitted changes (commit or stash first): ${rel}`);
  }

  // Active worktrees / unmerged feature branches: entities in in-progress or
  // in-evaluation still reference their legacy stage path from the worktree
  // branch. These require explicit acknowledgement.
  for (const move of moves) {
    if (ACTIVE_STAGE_DIRS.includes(move.stageDir)) {
      needsAck.push(move);
      warnings.push(
        `${move.entityType} #${move.number} is active (${move.stageDir}); its worktree/branch still references ${move.fromRel} until it merges`,
      );
    }
  }
  if (needsAck.length > 0 && !options.acknowledgeActive) {
    blockers.push(
      `${needsAck.length} active entity(ies) still reference legacy paths — re-run with --yes to acknowledge (see warnings)`,
    );
  }

  if (needsId.length > 0) {
    warnings.push(`${needsId.length} unnumbered legacy spec(s) will receive IDs on migrate`);
  }

  return { moves, blockers, warnings, needsAck, needsId };
}

function updateAigonIdFrontmatter(specPath, displayKey) {
  let content = fs.readFileSync(specPath, 'utf8');
  if (/^aigon_id:\s/m.test(content)) {
    content = content.replace(/^aigon_id:\s.*$/m, `aigon_id: ${displayKey}`);
  } else {
    content = content.replace(
      /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/,
      (_, fm) => `---\naigon_id: ${displayKey}\n${fm}\n---\n`,
    );
  }
  fs.writeFileSync(specPath, content);
}

function markIdentityMaterialized(repoPath, entityType, number) {
  try {
    const { createSpecStore } = require('./spec-store');
    const kind = entityType === 'research' ? 'research' : 'feature';
    createSpecStore({ repoPath }).markIdentityMaterializedSync(kind, number);
  } catch (_) { /* pending entries surface in doctor */ }
}

function finalizeAllocatedMove(repoPath, move) {
  if (!move.allocated || !move.aigonKey) return;
  updateAigonIdFrontmatter(move.to, move.aigonKey);
  markIdentityMaterialized(repoPath, move.entityType, move.number);
}

function isSameFileContent(a, b) {
  try {
    return fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  } catch (_) {
    return false;
  }
}

function isInsideSpecRoot(repoPath, entityType, target) {
  const root = path.resolve(repoPath, ENTITY_LAYOUT[entityType].docsDir);
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * Subset of `candidatePaths` that git reports as modified/staged/untracked.
 * Returns repo-relative paths.
 */
function listDirtySpecFiles(repoPath, candidatePaths) {
  if (candidatePaths.length === 0) return [];
  const rels = new Set(candidatePaths.map(p => path.relative(repoPath, p).replace(/\\/g, '/')));
  const out = [];
  const porcelain = tryGit(repoPath, ['status', '--porcelain', '--', ...candidatePaths.map(p => path.relative(repoPath, p))]);
  if (porcelain == null) return out;
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    // Format: "XY <path>" (rename shows "orig -> new"); take the last token.
    const file = line.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, '');
    if (rels.has(file)) out.push(file);
  }
  return out;
}

/**
 * Apply a validated plan. Moves each spec to `00-specs` (preserving git rename
 * history via `git mv` for tracked files), flips the layout version to stable,
 * and — when `commit` is set — commits only the explicit migration paths.
 *
 * Idempotent & recoverable: a move whose source is already gone and whose
 * destination already holds identical content is skipped, so an interrupted run
 * resumes safely and a completed run re-runs as a no-op.
 */
function applyMigrationPlan(repoPath, plan, options = {}) {
  const applied = [];
  const skipped = [];

  for (const move of plan.moves) {
    const srcExists = fs.existsSync(move.from);
    const destExists = fs.existsSync(move.to);

    if (!srcExists && destExists) {
      // Already migrated (resume/idempotent).
      skipped.push(move);
      continue;
    }
    if (srcExists && destExists) {
      if (isSameFileContent(move.from, move.to)) {
        // Partial run left both — remove the stale source.
        removePath(repoPath, move.from);
        finalizeAllocatedMove(repoPath, move);
        applied.push(move);
        continue;
      }
      throw new Error(`refusing to overwrite ${move.toRel}: content differs from ${move.fromRel}`);
    }
    if (!srcExists && !destExists) {
      throw new Error(`spec vanished mid-migration: ${move.fromRel}`);
    }

    fs.mkdirSync(path.dirname(move.to), { recursive: true });
    const tracked = tryGit(repoPath, ['ls-files', '--error-unmatch', '--', path.relative(repoPath, move.from)]) != null;
    if (tracked) {
      // Preserve rename history.
      runGit(repoPath, ['mv', path.relative(repoPath, move.from), path.relative(repoPath, move.to)]);
    } else {
      fs.renameSync(move.from, move.to);
    }
    finalizeAllocatedMove(repoPath, move);
    applied.push(move);
  }

  const configPath = setLayoutVersion(repoPath, LAYOUT_STABLE);

  const result = { applied, skipped, configPath, committed: false };

  if (options.commit) {
    const configRel = path.relative(repoPath, configPath);
    // Stage the config plus every destination. Tracked moves were already
    // staged as renames by `git mv`; re-adding the now-gone source path would
    // make `git add` fatal and stage nothing, so only add paths that exist.
    const addPaths = [configRel, ...applied.map(m => path.relative(repoPath, m.to))];
    tryGit(repoPath, ['add', '-A', '--', ...addPaths]);

    // Scope the commit to exactly what we staged (config + rename source/dest
    // sides), intersected with the real staged set so a gone rename-source or
    // an untracked source never trips `pathspec did not match`.
    // `--no-renames` so a rename's deletion and addition sides both surface as
    // distinct paths; otherwise the folded `R` entry hides the source path and
    // a pathspec-scoped commit would leave the source deletion staged.
    const stagedList = tryGit(repoPath, ['diff', '--cached', '--name-only', '--no-renames', '-z']);
    const stagedSet = new Set((stagedList || '').split('\0').filter(Boolean));
    const candidatePaths = new Set([configRel]);
    for (const move of applied) {
      candidatePaths.add(path.relative(repoPath, move.from));
      candidatePaths.add(path.relative(repoPath, move.to));
    }
    const commitPaths = [...candidatePaths].filter(p => stagedSet.has(p));

    const message = options.message
      || `chore(spec-layout): migrate ${applied.length} spec(s) to 00-specs and set layout=stable`;
    if (commitPaths.length > 0) {
      runGit(repoPath, ['commit', '-m', message, '--', ...commitPaths]);
      result.committed = true;
    }
  }

  return result;
}

function removePath(repoPath, target) {
  const tracked = tryGit(repoPath, ['ls-files', '--error-unmatch', '--', path.relative(repoPath, target)]) != null;
  if (tracked) {
    tryGit(repoPath, ['rm', '-f', '--', path.relative(repoPath, target)]);
  } else {
    try { fs.unlinkSync(target); } catch (_) { /* best-effort */ }
  }
}

module.exports = {
  LAYOUT_STABLE,
  LAYOUT_LEGACY,
  CANONICAL_SPEC_DIR,
  ENTITY_TYPES,
  getLayoutVersion,
  isStableLayout,
  setLayoutVersion,
  defaultLayoutForNewRepo,
  getCanonicalSpecDirForEntity,
  listCanonicalSpecs,
  listLegacySpecs,
  findCanonicalSpecFile,
  detectStatus,
  buildMigrationPlan,
  applyMigrationPlan,
};
