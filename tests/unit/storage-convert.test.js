#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, report, withTempDirAsync, GIT_SAFE_ENV, seedEntityDirs } = require('../_helpers');

function initLocalAigonRepo(base, { withRemote = true, remoteName = 'origin' } = {}) {
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  execSync('git init', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  if (withRemote) {
    const bare = path.join(base, 'remote.git');
    execSync(`git init --bare "${bare}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
    execSync(`git remote add ${remoteName} "${bare}"`, { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  }
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  execSync('git add README.md', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  execSync('git commit -m "init"', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  if (withRemote) {
    execSync(`git push -u ${remoteName} HEAD`, { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  }
  fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
  seedEntityDirs(repo, 'features');
  return repo;
}

function writeProjectionEvents(repo, entityType, entityId, events) {
  const dirName = entityType === 'research' ? 'research' : 'features';
  const eventsDir = path.join(repo, '.aigon', 'workflows', dirName, String(entityId));
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventsDir, 'events.jsonl'),
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
}

function loadConvertModule() {
  delete require.cache[require.resolve('../../lib/spec-store/convert.js')];
  delete require.cache[require.resolve('../../lib/spec-store/index.js')];
  delete require.cache[require.resolve('../../lib/spec-store/storage-config.js')];
  return require('../../lib/spec-store/convert.js');
}

function loadGitBranchStore(repo) {
  delete require.cache[require.resolve('../../lib/spec-store/index.js')];
  const { createSpecStore, resolveStorageConfig } = require('../../lib/spec-store/index.js');
  return createSpecStore({ repoPath: repo, storage: resolveStorageConfig(repo) });
}

testAsync('storage convert dry-run reports planned git-branch config without writing', async () => {
  // REGRESSION: dry-run must preview branch import without mutating disk (F613 AC).
  await withTempDirAsync('storage-convert-dry-', async (base) => {
    const repo = initLocalAigonRepo(base);
    writeProjectionEvents(repo, 'feature', '12', [
      { id: 'evt-12', type: 'feature.bootstrapped', at: '2026-06-25T04:00:00.000Z', featureId: '12', lifecycle: 'backlog' },
    ]);
    const { runStorageConvert } = loadConvertModule();
    const result = await runStorageConvert(repo, { dryRun: true, remote: 'origin' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.planned.backend, 'git-branch');
    assert.strictEqual(result.planned.git.remote, 'origin');
    assert.strictEqual(result.planned.git.branch, 'aigon-state');
    assert.strictEqual(result.importKeys.length, 1);
    assert.strictEqual(result.importKeys[0].key, 'F12');
    assert.ok(!fs.existsSync(path.join(repo, '.aigon', 'config.json')));
  });
});

testAsync('storage convert refuses missing remote unless dry-run', async () => {
  // REGRESSION: convert must fail loudly when remote is absent (F613 AC).
  await withTempDirAsync('storage-convert-no-remote-', async (base) => {
    const repo = initLocalAigonRepo(base, { withRemote: false });
    const { runStorageConvert } = loadConvertModule();
    const fail = await runStorageConvert(repo, { remote: 'origin' });
    assert.strictEqual(fail.ok, false);
    assert.match(fail.error, /remote "origin" not found/i);
    const preview = await runStorageConvert(repo, { remote: 'origin', dryRun: true });
    assert.strictEqual(preview.ok, true);
    assert.strictEqual(preview.dryRun, true);
    assert.ok(preview.remoteWarning);
  });
});

testAsync('storage convert is idempotent when git-branch config already exists', async () => {
  // REGRESSION: rerunning convert must report already configured (F613 AC).
  await withTempDirAsync('storage-convert-idempotent-', async (base) => {
    const repo = initLocalAigonRepo(base);
    const { runStorageConvert } = loadConvertModule();
    const first = await runStorageConvert(repo, { remote: 'origin' });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.converted, true);
    const result = await runStorageConvert(repo, { remote: 'origin' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.alreadyConfigured, true);
    assert.match(result.rollbackHint, /storage\.backend.*local/i);
  });
});

testAsync('storage convert accepts URL remote paths', async () => {
  // REGRESSION: remote may be a URL rather than a named remote (F613 AC).
  await withTempDirAsync('storage-convert-url-remote-', async (base) => {
    const repo = initLocalAigonRepo(base);
    const bare = path.join(base, 'remote.git');
    const { runStorageConvert } = loadConvertModule();
    const result = await runStorageConvert(repo, { remote: bare });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.converted, true);
    const config = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'config.json'), 'utf8'));
    assert.strictEqual(config.storage.git.remote, bare);
    assert.strictEqual(config.storage.backend, 'git-branch');
  });
});

testAsync('storage convert imports local projections on first enable', async () => {
  // REGRESSION: first convert must import numeric local workflow events (F613 AC).
  await withTempDirAsync('storage-convert-import-', async (base) => {
    const repo = initLocalAigonRepo(base);
    writeProjectionEvents(repo, 'feature', '7', [
      { id: 'evt-7', type: 'feature.bootstrapped', at: '2026-06-25T04:00:00.000Z', featureId: '7', lifecycle: 'backlog' },
    ]);
    const { runStorageConvert } = loadConvertModule();
    const result = await runStorageConvert(repo, { remote: 'origin' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.converted, true);
    assert.strictEqual(result.importCount, 1);
    const store = loadGitBranchStore(repo);
    assert.deepStrictEqual(store._readCanonicalEvents('F7').map((event) => event.id), ['evt-7']);
  });
});

testAsync('resolveStorageConfig rejects legacy git-ref backend loudly', async () => {
  // REGRESSION: git-ref config must not silently fall back to local (F294 / F613 AC).
  await withTempDirAsync('storage-config-gitref-error-', async (base) => {
    const repo = initLocalAigonRepo(base, { withRemote: false });
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), `${JSON.stringify({
      storage: { backend: 'git-ref', git: { remote: 'origin' } },
    }, null, 2)}\n`);
    delete require.cache[require.resolve('../../lib/spec-store/storage-config.js')];
    const { resolveStorageConfig } = require('../../lib/spec-store/storage-config.js');
    assert.throws(() => resolveStorageConfig(repo), /git-ref.*no longer supported/i);
  });
});

testAsync('storage convert rejects non-aigon directories', async () => {
  // REGRESSION: convert must refuse non-Aigon repos (F613 AC).
  await withTempDirAsync('storage-convert-not-aigon-', async (base) => {
    const repo = path.join(base, 'plain');
    fs.mkdirSync(repo);
    execSync('git init', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
    const { runStorageConvert } = loadConvertModule();
    const result = await runStorageConvert(repo, { dryRun: true });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /not an aigon repository/i);
  });
});

report();
