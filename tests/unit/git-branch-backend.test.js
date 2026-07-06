#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  testAsync,
  report,
  withTempDirAsync,
  GIT_SAFE_ENV,
} = require('../_helpers');

const {
  commitTreeWithFiles,
  readFileFromCommit,
  listTreeFiles,
  isAncestor,
  stateTrackingRef,
  runGit,
} = require('../../lib/spec-store/git-plumbing');
const { createGitBranchBackend, SCHEMA_VERSION } = require('../../lib/spec-store/git-branch-backend');
const { assertSpecStoreInterface } = require('../../lib/spec-store/interface');
const { resolveStorageConfig } = require('../../lib/spec-store/storage-config');

function git(cmd, cwd) {
  execSync(cmd, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
}

function bootstrapRepo(base) {
  const bare = path.join(base, 'origin.git');
  const repo = path.join(base, 'repo');
  execSync(`git init --bare "${bare}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  fs.mkdirSync(repo);
  git('git init', repo);
  git(`git remote add origin "${bare}"`, repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# t\n');
  git('git add -A', repo);
  git('git commit -m init', repo);
  git('git push -u origin HEAD', repo);
  return { bare, repo };
}

function bootEvent(id, featureId, at) {
  return { id, type: 'feature.bootstrapped', at, featureId, lifecycle: 'backlog' };
}

// ---------------------------------------------------------------------------
// storage-config
// ---------------------------------------------------------------------------
testAsync('resolveStorageConfig accepts git-branch with defaults and coerces unknowns to local', async () => {
  await withTempDirAsync('gb-config-', async (base) => {
    const repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.aigon', 'config.json'),
      JSON.stringify({ storage: { backend: 'git-branch', git: { remote: 'origin' } } }),
    );
    const cfg = resolveStorageConfig(repo);
    assert.strictEqual(cfg.backend, 'git-branch');
    assert.strictEqual(cfg.git.branch, 'aigon-state', 'default branch');
    assert.strictEqual(cfg.git.remote, 'origin');

    fs.writeFileSync(
      path.join(repo, '.aigon', 'config.json'),
      JSON.stringify({ storage: { backend: 'nonsense' } }),
    );
    assert.strictEqual(resolveStorageConfig(repo).backend, 'local', 'unknown backend coerces to local');
  });
});

// ---------------------------------------------------------------------------
// tree plumbing helpers
// ---------------------------------------------------------------------------
testAsync('commitTreeWithFiles builds an orphan commit and never touches the user index/worktree', async () => {
  await withTempDirAsync('gb-plumb-', async (base) => {
    const { repo } = bootstrapRepo(base);
    const headBefore = runGit(repo, ['rev-parse', 'HEAD']);

    const orphan = commitTreeWithFiles(repo, {
      baseCommit: null,
      updates: { 'meta.json': '{"v":1}\n', 'specs/F1/events.jsonl': '{"id":"a"}\n' },
      message: 'orphan',
      parents: [],
    });
    runGit(repo, ['update-ref', 'refs/heads/aigon-state', orphan]);

    // orphan: no parents
    assert.strictEqual(runGit(repo, ['rev-list', '--count', orphan]), '1', 'orphan has a single commit');
    assert.deepStrictEqual(
      listTreeFiles(repo, orphan, 'specs'),
      ['specs/F1/events.jsonl'],
    );
    assert.strictEqual(readFileFromCommit(repo, orphan, 'meta.json'), '{"v":1}');
    assert.strictEqual(readFileFromCommit(repo, orphan, 'missing.json'), null, 'absent file returns null');

    // second commit replaces one file against the base tree
    const next = commitTreeWithFiles(repo, {
      baseCommit: orphan,
      updates: { 'specs/F1/events.jsonl': '{"id":"a"}\n{"id":"b"}\n' },
      message: 'append',
      parents: [orphan],
    });
    assert.strictEqual(readFileFromCommit(repo, next, 'meta.json'), '{"v":1}', 'untouched file preserved');
    assert.strictEqual(readFileFromCommit(repo, next, 'specs/F1/events.jsonl'), '{"id":"a"}\n{"id":"b"}');
    assert.ok(isAncestor(repo, orphan, next), 'base is ancestor of next');
    assert.ok(!isAncestor(repo, next, orphan), 'ancestry is directional');

    // user worktree untouched: HEAD unchanged, git status clean of tracked changes
    assert.strictEqual(runGit(repo, ['rev-parse', 'HEAD']), headBefore, 'HEAD unchanged');
    const status = runGit(repo, ['status', '--porcelain']);
    assert.ok(!/README\.md|^ M|^M /.test(status), `worktree tracked files unchanged, got: ${status}`);

    // no throwaway index files left behind
    const cacheDir = path.join(repo, '.aigon', 'cache');
    const leftovers = fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter((f) => f.startsWith('git-branch-index'))
      : [];
    assert.strictEqual(leftovers.length, 0, 'throwaway index cleaned up');
  });
});

testAsync('stateTrackingRef collapses the default branch and namespaces others', async () => {
  assert.strictEqual(stateTrackingRef('aigon-state', 'aigon-state'), 'refs/aigon-internal/state');
  assert.strictEqual(stateTrackingRef('team/state', 'aigon-state'), 'refs/aigon-internal/team-state');
});

// ---------------------------------------------------------------------------
// backend interface + tree layout + append discipline
// ---------------------------------------------------------------------------
testAsync('git-branch backend satisfies the SpecStore interface and writes the documented tree layout', async () => {
  await withTempDirAsync('gb-layout-', async (base) => {
    const { repo } = bootstrapRepo(base);
    const store = createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: true });
    assertSpecStoreInterface(store);

    const ref = { entityType: 'feature', entityId: '42' };
    await store.appendEvent(ref, bootEvent('e1', '42', '2026-07-01T00:00:00.000Z'));
    await store.appendEvent(ref, bootEvent('e2', '42', '2026-07-01T01:00:00.000Z'));
    // idempotent re-append of e1 does not duplicate
    await store.appendEvent(ref, bootEvent('e1', '42', '2026-07-01T00:00:00.000Z'));

    const tip = runGit(repo, ['rev-parse', 'refs/heads/aigon-state']);
    assert.deepStrictEqual(
      listTreeFiles(repo, tip).sort(),
      ['meta.json', 'specs/F42/events.jsonl'],
      'exact tree layout: meta.json + specs/<KEY>/events.jsonl',
    );
    const meta = JSON.parse(readFileFromCommit(repo, tip, 'meta.json'));
    assert.deepStrictEqual(meta, {
      schemaVersion: SCHEMA_VERSION,
      backend: 'git-branch',
      branch: 'aigon-state',
      remote: 'origin',
    });
    assert.deepStrictEqual(store._readCanonicalEvents('F42').map((e) => e.id), ['e1', 'e2']);
    // events.jsonl is browsable JSONL (one object per line)
    const lines = readFileFromCommit(repo, tip, 'specs/F42/events.jsonl').split('\n');
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(JSON.parse(lines[0]).id, 'e1');

    // branch never checked out — HEAD is not aigon-state
    assert.notStrictEqual(runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'aigon-state');
  });
});

testAsync('sync() refuses to downgrade when branch schemaVersion is newer', async () => {
  await withTempDirAsync('gb-schema-', async (base) => {
    const { repo } = bootstrapRepo(base);
    const store = createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: true });
    await store.appendEvent({ entityType: 'feature', entityId: '7' }, bootEvent('e1', '7', '2026-07-01T00:00:00.000Z'));

    // Forge a future-schema meta.json onto the tracking ref the merge inspects.
    const tip = runGit(repo, ['rev-parse', 'refs/heads/aigon-state']);
    const future = commitTreeWithFiles(repo, {
      baseCommit: tip,
      updates: { 'meta.json': JSON.stringify({ schemaVersion: SCHEMA_VERSION + 5, backend: 'git-branch' }) + '\n' },
      message: 'future',
      parents: [tip],
    });
    runGit(repo, ['update-ref', store._trackingRef, future]);

    await assert.rejects(
      () => store._mergeRemote(),
      /schemaVersion .* refusing to downgrade/i,
      'newer schema must fail loudly',
    );
  });
});

report();
