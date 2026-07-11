#!/usr/bin/env node
'use strict';

/**
 * F669 — generated lifecycle symlink view.
 *
 * Covers: create/project, feature+research parity, idempotent rebuild (manifest
 * deletion reproduces the view), stage-change replacement, obsolete removal,
 * missing-target broken links, unsafe regular-file and out-of-root collisions,
 * duplicate identity blocking, and the legacy-layout no-op gate.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report, seedEntityDirs, writeSnap, initGitRepo } = require('../_helpers');
const { runFeatureEffect } = require('../../lib/workflow-core/effects');
const { reconcileEntitySpec } = require('../../lib/spec-reconciliation');

function freshSpecView() {
  delete require.cache[require.resolve('../../lib/spec-view')];
  delete require.cache[require.resolve('../../lib/spec-layout')];
  return require('../../lib/spec-view');
}

const DOCS = { features: 'features', research: 'research-topics' };

function setStable(repo) {
  const p = path.join(repo, '.aigon', 'config.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  cfg.specLayout = 'stable';
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}

/** Write a real canonical file under 00-specs and return its basename. */
function writeCanonical(repo, kind, prefix, id, slug) {
  const dir = path.join(repo, 'docs', 'specs', DOCS[kind], '00-specs');
  fs.mkdirSync(dir, { recursive: true });
  const file = `${prefix}-${String(id).padStart(2, '0')}-${slug}.md`;
  fs.writeFileSync(path.join(dir, file), `---\naigon_id: ${id}\n---\n\n# ${slug}\n\ncontent\n`);
  return file;
}

function linkAt(repo, kind, stage, file) {
  return path.join(repo, 'docs', 'specs', DOCS[kind], stage, file);
}

function readlinkTarget(p) {
  return fs.readlinkSync(p);
}

test('projects a relative symlink into the mapped stage folder for feature + research', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    setStable(repo);
    seedEntityDirs(repo, 'features');
    seedEntityDirs(repo, 'research-topics');

    const fFile = writeCanonical(repo, 'features', 'feature', 7, 'alpha');
    writeSnap(repo, 'features', 7, 'implementing'); // -> 03-in-progress
    const rFile = writeCanonical(repo, 'research', 'research', 3, 'beta');
    writeSnap(repo, 'research', 3, 'backlog'); // -> 02-backlog

    const result = specView.refreshView(repo);
    assert.strictEqual(result.skipped, undefined, 'not skipped under stable layout');
    assert.strictEqual(result.created.length, 2, 'two links created');
    assert.strictEqual(result.blocked.length, 0, 'no collisions');

    const fLink = linkAt(repo, 'features', '03-in-progress', fFile);
    const rLink = linkAt(repo, 'research', '02-backlog', rFile);
    assert.ok(fs.lstatSync(fLink).isSymbolicLink(), 'feature link is a symlink');
    assert.strictEqual(readlinkTarget(fLink), path.join('..', '00-specs', fFile), 'relative target into 00-specs');
    assert.strictEqual(readlinkTarget(rLink), path.join('..', '00-specs', rFile), 'research parity');
    // Symlink resolves to the one canonical file.
    assert.ok(fs.existsSync(fLink), 'feature link resolves to real content');
    assert.ok(fs.readFileSync(fLink, 'utf8').includes('# alpha'), 'link exposes canonical content');
  });
});

test('idempotent — rebuild after deleting the manifest reproduces the same view', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    setStable(repo);
    seedEntityDirs(repo, 'features');
    writeCanonical(repo, 'features', 'feature', 1, 'x');
    writeSnap(repo, 'features', 1, 'done'); // -> 05-done

    const first = specView.refreshView(repo);
    assert.strictEqual(first.created.length, 1);

    // Second run: nothing changes.
    const second = specView.refreshView(repo);
    assert.strictEqual(second.created.length, 0, 'no re-create');
    assert.strictEqual(second.kept.length, 1, 'link kept untouched');

    // Delete the manifest and rebuild: same view, still a keep (detection is by
    // target inspection, not the manifest).
    fs.rmSync(path.join(repo, specView.MANIFEST_REL));
    const third = specView.refreshView(repo);
    assert.strictEqual(third.created.length, 0, 'manifest loss does not recreate');
    assert.strictEqual(third.kept.length, 1, 'view reconstructed from disk state');
    assert.ok(fs.existsSync(path.join(repo, specView.MANIFEST_REL)), 'manifest rewritten');
  });
});

test('stage change replaces the obsolete managed link with one in the new folder', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    setStable(repo);
    seedEntityDirs(repo, 'features');
    const file = writeCanonical(repo, 'features', 'feature', 5, 'mover');

    writeSnap(repo, 'features', 5, 'backlog'); // -> 02-backlog
    specView.refreshView(repo);
    assert.ok(fs.lstatSync(linkAt(repo, 'features', '02-backlog', file)).isSymbolicLink());

    // Move to in-progress.
    writeSnap(repo, 'features', 5, 'implementing'); // -> 03-in-progress
    const result = specView.refreshView(repo);
    assert.strictEqual(result.created.length, 1, 'new-folder link created');
    assert.strictEqual(result.removed.length, 1, 'old-folder managed link removed');
    assert.ok(!fs.existsSync(linkAt(repo, 'features', '02-backlog', file)), 'obsolete link gone');
    assert.ok(fs.lstatSync(linkAt(repo, 'features', '03-in-progress', file)).isSymbolicLink(), 'new link present');
  });
});

test('missing local canonical content yields a diagnosable broken (dangling) link from snapshot metadata', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    setStable(repo);
    seedEntityDirs(repo, 'features');
    // No canonical file written; snapshot carries a specPath basename.
    const dir = path.join(repo, '.aigon', 'workflows', 'features', '9');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({
      entityType: 'feature', featureId: '9', currentSpecState: 'implementing', lifecycle: 'implementing',
      specPath: 'docs/specs/features/00-specs/feature-09-ghost.md',
    }));

    const result = specView.refreshView(repo);
    assert.strictEqual(result.created.length, 1, 'broken link still created for navigation');
    const link = linkAt(repo, 'features', '03-in-progress', 'feature-09-ghost.md');
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'symlink exists');
    assert.ok(!fs.existsSync(link), 'target is unavailable on this checkout (dangling)');
    assert.strictEqual(result.managed.find((m) => m.id === '9').broken, true, 'manifest flags broken');
  });
});

test('a regular file in a managed path blocks that entity and is never overwritten', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    initGitRepo(repo);
    setStable(repo);
    seedEntityDirs(repo, 'features');
    const file = writeCanonical(repo, 'features', 'feature', 2, 'clash');
    writeSnap(repo, 'features', 2, 'implementing');

    // Pre-existing REAL file exactly where the link would go.
    const collide = linkAt(repo, 'features', '03-in-progress', file);
    fs.writeFileSync(collide, 'hand-written content');

    const result = specView.refreshView(repo);
    assert.strictEqual(result.created.length, 0, 'nothing created over the file');
    assert.strictEqual(result.blocked.length, 1, 'one collision reported');
    assert.strictEqual(result.blocked[0].code, specView.DIAG.REGULAR_FILE);
    assert.ok(!fs.lstatSync(collide).isSymbolicLink(), 'still a regular file');
    assert.strictEqual(fs.readFileSync(collide, 'utf8'), 'hand-written content', 'content preserved');
    assert.ok(!result.managed.some((m) => m.path.endsWith(file)), 'blocked file not marked managed');
    assert.ok(!JSON.stringify(specView.readManifest(repo)).includes(file), 'blocked file not written to manifest');
    assert.ok(!fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').includes(file), 'blocked file not excluded from git');
  });
});

test('an unmanaged out-of-root symlink blocks that entity and is left in place', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    setStable(repo);
    seedEntityDirs(repo, 'features');
    const file = writeCanonical(repo, 'features', 'feature', 4, 'evil');
    writeSnap(repo, 'features', 4, 'implementing');

    const link = linkAt(repo, 'features', '03-in-progress', file);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync('/etc/hosts', link); // absolute, out of root → unmanaged

    const result = specView.refreshView(repo);
    assert.strictEqual(result.blocked.length, 1, 'collision reported');
    assert.strictEqual(result.blocked[0].code, specView.DIAG.OUT_OF_ROOT);
    assert.strictEqual(fs.readlinkSync(link), '/etc/hosts', 'unsafe link untouched');
  });
});

test('duplicate canonical identity blocks the entity', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    setStable(repo);
    seedEntityDirs(repo, 'features');
    writeCanonical(repo, 'features', 'feature', 8, 'one');
    writeCanonical(repo, 'features', 'feature', 8, 'two'); // same id, two files
    writeSnap(repo, 'features', 8, 'implementing');

    const result = specView.refreshView(repo);
    assert.strictEqual(result.created.length, 0, 'ambiguous identity not projected');
    assert.ok(result.blocked.some((b) => b.code === specView.DIAG.DUPLICATE_IDENTITY), 'duplicate reported');
  });
});

test('legacy layout is a no-op (view only exists under stable layout)', () => {
  withTempDir((repo) => {
    const specView = freshSpecView();
    // No specLayout set → legacy.
    seedEntityDirs(repo, 'features');
    writeCanonical(repo, 'features', 'feature', 1, 'legacy');
    writeSnap(repo, 'features', 1, 'implementing');

    const result = specView.refreshView(repo);
    assert.strictEqual(result.skipped, true, 'skipped under legacy layout');
    assert.strictEqual(result.reason, 'legacy-layout');
    assert.ok(!fs.existsSync(linkAt(repo, 'features', '03-in-progress', 'feature-01-legacy.md')));
  });
});

testAsync('stable move_spec effects refresh the lifecycle view without moving files', async () => {
  await withTempDirAsync((repo) => {
    setStable(repo);
    seedEntityDirs(repo, 'features');
    const file = writeCanonical(repo, 'features', 'feature', 2, 'effect-skip');
    writeSnap(repo, 'features', 2, 'done');

    const legacySource = linkAt(repo, 'features', '04-in-evaluation', file);
    fs.writeFileSync(legacySource, 'legacy real file that must not move');
    const legacyTarget = linkAt(repo, 'features', '05-done', file);

    return runFeatureEffect(repo, '02', {
      type: 'move_spec',
      payload: {
        entityType: 'feature',
        entityId: '02',
        fromPath: legacySource,
        toPath: legacyTarget,
        toLifecycle: 'done',
      },
    }).then(() => {
      assert.strictEqual(fs.readFileSync(legacySource, 'utf8'), 'legacy real file that must not move');
      assert.ok(fs.lstatSync(legacyTarget).isSymbolicLink(), 'done folder contains generated view link');
      assert.strictEqual(fs.readlinkSync(legacyTarget), path.join('..', '00-specs', file));
      assert.ok(fs.readFileSync(legacyTarget, 'utf8').includes('# effect-skip'), 'view link resolves to canonical content');
    });
  });
});

test('stable reconciliation refreshes the view and never physically moves feature specs', () => {
  withTempDir((repo) => {
    setStable(repo);
    seedEntityDirs(repo, 'features');
    const file = writeCanonical(repo, 'features', 'feature', 6, 'reconcile-skip');
    writeSnap(repo, 'features', 6, 'implementing');

    const staleRealFile = linkAt(repo, 'features', '02-backlog', file);
    fs.writeFileSync(staleRealFile, 'stale real stage file');

    const result = reconcileEntitySpec(repo, 'feature', '6', { dryRun: false });
    assert.strictEqual(result.skipped, 'stable-layout-view');
    assert.strictEqual(fs.readFileSync(staleRealFile, 'utf8'), 'stale real stage file', 'stale real file left untouched');

    const viewLink = linkAt(repo, 'features', '03-in-progress', file);
    assert.ok(fs.lstatSync(viewLink).isSymbolicLink(), 'generated view link created for workflow state');
    assert.strictEqual(fs.readlinkSync(viewLink), path.join('..', '00-specs', file));
  });
});

report();
