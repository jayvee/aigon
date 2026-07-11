'use strict';

/**
 * Spec-view projector: generate local, disposable lifecycle status folders as
 * relative symlinks pointing back at canonical `00-specs` files (F669,
 * set: stable-spec-layout member 4).
 *
 * Design invariants (see spec ## Technical Approach):
 *   - Canonical content lives ONLY under `00-specs`; lifecycle folders hold a
 *     navigational *view* of local, disposable relative symlinks. Never copies,
 *     hardlinks, or tracked links.
 *   - One projector computes the complete desired `{linkPath -> relTarget}`
 *     view from current snapshots + canonical identities and reconciles it
 *     idempotently. It never replays incremental move intents or an event
 *     ledger. Deleting the manifest and rebuilding produces the same view.
 *   - Reconciliation only ever touches paths it can *prove* are Aigon-managed
 *     (a relative symlink resolving to a direct child of the matching kind's
 *     `00-specs`). A regular file, an unmanaged symlink, an out-of-root target,
 *     a duplicate canonical identity, or missing content BLOCKS that entity and
 *     produces a structured diagnostic — Aigon never deletes or overwrites it.
 *   - Symlinks are inspected with `lstat`/`readlink` (never followed) when
 *     validating or cleaning.
 *   - The view runs only under `specLayout: stable`; in legacy layout the
 *     canonical files already live in the stage folders and there is nothing to
 *     project, so refresh is a no-op.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  getCanonicalSpecDirForEntity,
  CANONICAL_SPEC_DIR,
  CANONICAL_STAGE_DIRS,
  LIFECYCLE_TO_FEATURE_DIR,
  LIFECYCLE_TO_RESEARCH_DIR,
} = require('./workflow-core/paths');
const { isStableLayout, listCanonicalSpecs } = require('./spec-layout-core');

const ENTITY_TYPES = Object.freeze(['feature', 'research']);

// Where workflow snapshots live (`.aigon/workflows/<dir>/<id>/snapshot.json`)
// and where lifecycle folders live (`docs/specs/<docsDir>/<stage>/`).
const ENTITY_VIEW = Object.freeze({
  feature: { workflowDir: 'features', docsDir: 'features', lifecycleDirMap: LIFECYCLE_TO_FEATURE_DIR },
  research: { workflowDir: 'research', docsDir: 'research-topics', lifecycleDirMap: LIFECYCLE_TO_RESEARCH_DIR },
});

const MANIFEST_REL = path.join('.aigon', 'state', 'spec-view-manifest.json');
const MANIFEST_VERSION = 1;

const EXCLUDE_BEGIN = '# BEGIN aigon spec-view (generated, disposable — do not edit)';
const EXCLUDE_END = '# END aigon spec-view';

// Diagnostic codes for blocked entities / colliding paths.
const DIAG = Object.freeze({
  REGULAR_FILE: 'regular-file',
  UNMANAGED_SYMLINK: 'unmanaged-symlink',
  OUT_OF_ROOT: 'out-of-root-target',
  DUPLICATE_IDENTITY: 'duplicate-canonical-identity',
  CONTENT_UNAVAILABLE: 'content-unavailable',
});

// ---------------------------------------------------------------------------
// Snapshot enumeration (read-only; no require cycle with workflow-read-model)
// ---------------------------------------------------------------------------

function workflowRoot(repoPath, entityType) {
  return path.join(repoPath, '.aigon', 'workflows', ENTITY_VIEW[entityType].workflowDir);
}

function listEntityIds(repoPath, entityType) {
  const root = workflowRoot(repoPath, entityType);
  try {
    return fs
      .readdirSync(root)
      .filter((d) => /^\d+$/.test(d) && fs.existsSync(path.join(root, d, 'snapshot.json')))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch (_) {
    return [];
  }
}

function readSnapshot(repoPath, entityType, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(workflowRoot(repoPath, entityType), id, 'snapshot.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Managed-link detection (lstat/readlink only — never follow)
// ---------------------------------------------------------------------------

/**
 * Is `linkAbsPath` a link Aigon may safely manage: a *relative* symlink whose
 * target resolves (lexically) to a direct child of this kind's `00-specs`?
 */
function isManagedLink(repoPath, entityType, linkAbsPath) {
  let target;
  try {
    if (!fs.lstatSync(linkAbsPath).isSymbolicLink()) return false;
    target = fs.readlinkSync(linkAbsPath);
  } catch (_) {
    return false;
  }
  if (path.isAbsolute(target)) return false;
  const resolved = path.resolve(path.dirname(linkAbsPath), target);
  const canonicalDir = getCanonicalSpecDirForEntity(repoPath, entityType);
  const rel = path.relative(canonicalDir, resolved);
  return rel.length > 0 && !rel.startsWith('..') && !rel.includes(path.sep);
}

/** Every currently-present managed link across all kinds and stage folders. */
function listManagedLinks(repoPath) {
  const out = [];
  for (const entityType of ENTITY_TYPES) {
    const docsRoot = path.join(repoPath, 'docs', 'specs', ENTITY_VIEW[entityType].docsDir);
    for (const stageDir of CANONICAL_STAGE_DIRS) {
      const dir = path.join(docsRoot, stageDir);
      let entries;
      try {
        entries = fs.readdirSync(dir);
      } catch (_) {
        continue;
      }
      for (const file of entries) {
        const full = path.join(dir, file);
        if (isManagedLink(repoPath, entityType, full)) out.push(full);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Desired view
// ---------------------------------------------------------------------------

/**
 * Compute the complete desired view from current snapshots + canonical
 * identities. Pure — never writes.
 * @returns {{links: Object<string,object>, diagnostics: Array<object>}}
 */
function computeDesiredView(repoPath) {
  const links = Object.create(null);
  const diagnostics = [];

  for (const entityType of ENTITY_TYPES) {
    const cfg = ENTITY_VIEW[entityType];
    const docsRoot = path.join(repoPath, 'docs', 'specs', cfg.docsDir);

    // Canonical identity index; flag duplicate numeric identities as blockers.
    const canonical = listCanonicalSpecs(repoPath, entityType);
    const byNum = new Map();
    const dupNums = new Set();
    for (const c of canonical) {
      if (byNum.has(c.number)) dupNums.add(c.number);
      byNum.set(c.number, c);
    }

    for (const id of listEntityIds(repoPath, entityType)) {
      const snap = readSnapshot(repoPath, entityType, id);
      if (!snap) continue;
      const lifecycle = snap.currentSpecState || snap.lifecycle;
      const stageFolder = cfg.lifecycleDirMap[lifecycle];
      if (!stageFolder) continue; // unmapped lifecycle → no view entry

      const num = parseInt(id, 10);
      if (dupNums.has(num)) {
        diagnostics.push({
          entityType,
          id,
          code: DIAG.DUPLICATE_IDENTITY,
          message: `${entityType}#${id}: multiple canonical files share this identity`,
        });
        continue;
      }

      // Basename: prefer the real canonical file; otherwise fall back to the
      // snapshot's recorded spec path so a checkout without local content can
      // still expose a clearly-diagnosable broken link.
      const canon = byNum.get(num);
      let basename = canon ? canon.file : null;
      let broken = false;
      if (!basename && snap.specPath) {
        basename = path.basename(snap.specPath);
        broken = true;
      }
      if (!basename) {
        diagnostics.push({
          entityType,
          id,
          code: DIAG.CONTENT_UNAVAILABLE,
          message: `${entityType}#${id}: content unavailable on this checkout`,
        });
        continue;
      }

      const linkPath = path.join(docsRoot, stageFolder, basename);
      const target = path.join('..', CANONICAL_SPEC_DIR, basename); // ../00-specs/<basename>
      links[linkPath] = { target, entityType, id: String(id), basename, broken, stageFolder };
    }
  }

  return { links, diagnostics };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function toRel(repoPath, abs) {
  return path.relative(repoPath, abs).split(path.sep).join('/');
}

function ensureSymlink(linkPath, target) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);
}

/**
 * Reconcile the on-disk view to the desired projection. Idempotent: correct
 * links are left untouched, obsolete managed links removed, missing links
 * created, wrong managed targets replaced. Unsafe collisions block that entity
 * and never overwrite anything.
 */
function reconcileView(repoPath, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const { links: desired, diagnostics } = computeDesiredView(repoPath);
  const blocked = [...diagnostics];
  const created = [];
  const removed = [];
  const replaced = [];
  const kept = [];
  const managedByPath = new Map();

  const markManaged = (linkPath, info) => {
    managedByPath.set(linkPath, {
      path: toRel(repoPath, linkPath),
      target: info.target,
      entityType: info.entityType,
      id: info.id,
      broken: info.broken,
    });
  };

  const obsolete = new Set(listManagedLinks(repoPath));

  for (const [linkPath, info] of Object.entries(desired)) {
    obsolete.delete(linkPath);
    let st = null;
    try {
      st = fs.lstatSync(linkPath);
    } catch (_) {
      st = null;
    }

    if (st) {
      if (!st.isSymbolicLink()) {
        blocked.push({
          entityType: info.entityType,
          id: info.id,
          code: DIAG.REGULAR_FILE,
          message: `${toRel(repoPath, linkPath)}: a regular file occupies a managed link path`,
          path: toRel(repoPath, linkPath),
        });
        continue;
      }
      if (!isManagedLink(repoPath, info.entityType, linkPath)) {
        blocked.push({
          entityType: info.entityType,
          id: info.id,
          code: DIAG.OUT_OF_ROOT,
          message: `${toRel(repoPath, linkPath)}: an unmanaged symlink points outside 00-specs`,
          path: toRel(repoPath, linkPath),
        });
        continue;
      }
      const cur = fs.readlinkSync(linkPath);
      if (cur === info.target) {
        kept.push(toRel(repoPath, linkPath));
        markManaged(linkPath, info);
        continue;
      }
      // Wrong managed target → replace.
      if (!dryRun) {
        fs.unlinkSync(linkPath);
        ensureSymlink(linkPath, info.target);
      }
      replaced.push(toRel(repoPath, linkPath));
      markManaged(linkPath, info);
      continue;
    }

    // Absent → create.
    if (!dryRun) ensureSymlink(linkPath, info.target);
    created.push(toRel(repoPath, linkPath));
    markManaged(linkPath, info);
  }

  // Obsolete managed links (stage change, closed entity) → remove.
  for (const linkPath of obsolete) {
    if (!dryRun) {
      try {
        fs.unlinkSync(linkPath);
      } catch (_) {
        /* best effort */
      }
    }
    removed.push(toRel(repoPath, linkPath));
  }

  const managed = [...managedByPath.values()];

  if (!dryRun) {
    writeManifest(repoPath, managed);
    updateGitExclude(repoPath, managed.map((m) => m.path));
  }

  return { created, removed, replaced, kept, blocked, managed, dryRun, desiredCount: Object.keys(desired).length };
}

// ---------------------------------------------------------------------------
// Disposable manifest (`.aigon/state/`) — safety/diagnostics only
// ---------------------------------------------------------------------------

function writeManifest(repoPath, managed) {
  const p = path.join(repoPath, MANIFEST_REL);
  const manifest = { version: MANIFEST_VERSION, refreshedAt: new Date().toISOString(), managed };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readManifest(repoPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoPath, MANIFEST_REL), 'utf8'));
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Git exclusion — keep generated links out of commits without tracked churn.
// Written to the repo's local `info/exclude` (untracked, disposable).
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateGitExclude(repoPath, managedRelPaths) {
  let excludePath;
  try {
    excludePath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return; // not a git repo — nothing to exclude
  }
  if (!path.isAbsolute(excludePath)) excludePath = path.join(repoPath, excludePath);

  let content = '';
  try {
    content = fs.readFileSync(excludePath, 'utf8');
  } catch (_) {
    content = '';
  }
  const blockRe = new RegExp(`\\n*${escapeRe(EXCLUDE_BEGIN)}[\\s\\S]*?${escapeRe(EXCLUDE_END)}\\n*`, 'g');
  content = content.replace(blockRe, '\n');

  const lines = [EXCLUDE_BEGIN, ...managedRelPaths.map((p) => `/${p}`), EXCLUDE_END];
  const next = `${content.replace(/\s+$/, '')}\n\n${lines.join('\n')}\n`.replace(/^\n+/, '');
  try {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.writeFileSync(excludePath, next);
  } catch (_) {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Refresh the lifecycle view. Gated on `specLayout: stable` — a no-op under the
 * legacy layout where canonical files already live in the stage folders. Never
 * throws for view-collision reasons; blocked entities are reported in the
 * result so a failed refresh cannot roll back published canonical state.
 */
function refreshView(repoPath, options = {}) {
  if (!isStableLayout(repoPath)) {
    return {
      skipped: true,
      reason: 'legacy-layout',
      created: [],
      removed: [],
      replaced: [],
      kept: [],
      blocked: [],
      managed: [],
      desiredCount: 0,
    };
  }
  return reconcileView(repoPath, options);
}

function entityIdsMatch(a, b) {
  const na = String(parseInt(a, 10));
  const nb = String(parseInt(b, 10));
  if (na === 'NaN' || nb === 'NaN') return String(a) === String(b);
  return na === nb;
}

/**
 * Mirror stable-layout lifecycle symlinks from the main checkout into a
 * feature worktree. Worktrees do not carry `.aigon/workflows/` snapshots, so
 * `refreshView(worktreePath)` cannot project links — we copy the desired view
 * computed from the main repo instead of materialising a regular spec file.
 */
function syncWorktreeLifecycleLinks(mainRepoPath, worktreePath, entityType, entityId) {
  if (!isStableLayout(mainRepoPath)) {
    return { skipped: true, reason: 'legacy-layout', synced: [] };
  }
  const { links } = computeDesiredView(mainRepoPath);
  const synced = [];
  for (const [linkAbsPath, info] of Object.entries(links)) {
    if (info.entityType !== entityType || !entityIdsMatch(info.id, entityId)) continue;
    const relLink = path.relative(mainRepoPath, linkAbsPath).split(path.sep).join('/');
    const wtLink = path.join(worktreePath, relLink);
    fs.mkdirSync(path.dirname(wtLink), { recursive: true });
    let st = null;
    try { st = fs.lstatSync(wtLink); } catch (_) { st = null; }
    if (st && !st.isSymbolicLink()) {
      fs.unlinkSync(wtLink);
      st = null;
    }
    if (!st) {
      fs.symlinkSync(info.target, wtLink);
      synced.push(relLink);
      continue;
    }
    try {
      const current = fs.readlinkSync(wtLink);
      if (current !== info.target) {
        fs.unlinkSync(wtLink);
        fs.symlinkSync(info.target, wtLink);
        synced.push(relLink);
      }
    } catch (_) { /* leave existing link */ }
  }
  if (synced.length > 0) {
    updateGitExclude(worktreePath, synced);
  }
  return { synced };
}

module.exports = {
  DIAG,
  MANIFEST_REL,
  computeDesiredView,
  isManagedLink,
  listManagedLinks,
  reconcileView,
  refreshView,
  readManifest,
  syncWorktreeLifecycleLinks,
  entityIdsMatch,
};
