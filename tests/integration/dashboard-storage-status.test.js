#!/usr/bin/env node
// REGRESSION feature 596: dashboard must expose server-owned storage status and
// active lease metadata on repo/feature payloads without frontend inference.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, report, withTempDirAsync, GIT_SAFE_ENV } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
const { buildDashboardSettingsPayload } = require('../../lib/dashboard-settings');
const {
    buildRepoStorageStatus,
    buildEntityActiveLeases,
} = require('../../lib/dashboard-storage');

function initRepoWithBareRemote(base) {
    const bare = path.join(base, 'remote.git');
    const repo = path.join(base, 'repo');
    fs.mkdirSync(repo);
    execSync(`git init --bare "${bare}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
    execSync('git init', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
    execSync('git remote add origin ../remote.git', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
    fs.mkdirSync(path.join(repo, 'docs/specs/features/02-backlog'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
    execSync('git add README.md docs', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
    execSync('git commit -m "init"', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
    execSync('git push -u origin HEAD', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), `${JSON.stringify({
        storage: {
            backend: 'git-branch',
            git: { remote: 'origin', branch: 'aigon-state' },
        },
    }, null, 2)}\n`);
    return { repo, bare };
}

test('buildRepoStorageStatus: local backend omits git-branch-only fields', () => {
    // REGRESSION: local repos must not surface misleading git metadata (feature 596 AC).
    const status = buildRepoStorageStatus(process.cwd());
    assert.strictEqual(status.backend, 'local');
    assert.strictEqual(status.health, 'ok');
    assert.strictEqual(status.remote, undefined);
    assert.strictEqual(status.branch, undefined);
});

test('buildRepoStorageStatus: legacy git-ref config surfaces convert hint', () => {
    // REGRESSION F613: git-ref config must fail loudly with convert command, not silent local fallback.
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dash-gitref-'));
    fs.mkdirSync(path.join(tmp, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.aigon', 'config.json'), JSON.stringify({
        storage: { backend: 'git-ref', git: { remote: 'origin' } },
    }));
    const status = buildRepoStorageStatus(tmp);
    assert.strictEqual(status.backend, 'git-ref-removed');
    assert.match(status.lastError, /git-ref.*no longer supported/i);
    assert.match(status.convertHint, /storage convert/);
    fs.rmSync(tmp, { recursive: true, force: true });
});

testAsync('collectRepoStatus attaches storage and active leases for git-branch repo', async () => {
    // REGRESSION: poll payload must carry storage DTO + active lease rows (feature 596 AC).
    await withTempDirAsync('dash-storage-', async (base) => {
        const { repo } = initRepoWithBareRemote(base);
        const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-88-storage.md');
        fs.writeFileSync(specPath, '# Feature: storage\n');
        engine.ensureEntityBootstrappedSync(repo, 'feature', '88', 'backlog', specPath, { authorAgentId: 'cu' });
        await engine.startFeature(repo, '88', 'solo_branch', ['cu']);

        delete require.cache[require.resolve('../../lib/spec-store/index.js')];
        const { createSpecStore, resolveStorageConfig } = require('../../lib/spec-store/index.js');
        const store = createSpecStore({ repoPath: repo, storage: resolveStorageConfig(repo) });
        await store.acquireLease({ entityType: 'feature', entityId: '88' }, {
            role: 'impl',
            agentId: 'cu',
            holderId: 'machine-dashboard-test',
        });

        clearTierCache(repo);
        const status = collectRepoStatus(repo, { summary: { total: 0 } });
        assert.ok(status.storage, 'repo.storage missing');
        assert.strictEqual(status.storage.backend, 'git-branch');
        assert.strictEqual(status.storage.remote, 'origin');
        assert.strictEqual(status.storage.branch, 'aigon-state');
        assert.ok(Array.isArray(status.validActions));
        assert.ok(status.validActions.some((va) => va.action === 'storage' && va.args[0] === 'sync'));

        const feature = (status.features || []).find((f) => String(f.id) === '88');
        assert.ok(feature, 'feature 88 missing from collector');
        assert.ok(Array.isArray(feature.activeLeases));
        assert.strictEqual(feature.activeLeases.length, 1);
        const lease = feature.activeLeases[0];
        assert.strictEqual(lease.specKey, 'F88');
        assert.strictEqual(lease.role, 'impl');
        assert.strictEqual(lease.holderId, 'machine-dashboard-test');
        assert.strictEqual(lease.agentId, 'cu');
        assert.strictEqual(lease.expired, false);
        assert.ok(lease.acquiredAt);
        assert.ok(lease.expiresAt);

        const settings = buildDashboardSettingsPayload(repo);
        assert.deepStrictEqual(settings.storage.backend, 'git-branch');
        assert.ok(Array.isArray(settings.storageActions));
        assert.ok(settings.storageActions.some((va) => va.action === 'storage' && va.args[0] === 'doctor'));
    });
});

test('buildEntityActiveLeases returns empty for non-numeric ids', () => {
    assert.deepStrictEqual(buildEntityActiveLeases(process.cwd(), 'feature', 'inbox-slug'), []);
});

report();
