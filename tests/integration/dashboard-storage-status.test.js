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
    applyForeignLeaseActionBlocks,
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

test('applyForeignLeaseActionBlocks disables close and reset actions for foreign leases', () => {
    const previousMachineId = process.env.AIGON_MACHINE_ID;
    process.env.AIGON_MACHINE_ID = 'machine-local';
    try {
        const item = {
            validActions: [
                { action: 'feature-close', label: 'Close' },
                { action: 'feature-reset', label: 'Reset' },
                { action: 'feature-start', label: 'Start' },
            ],
        };
        applyForeignLeaseActionBlocks(item, 'feature', [{
            role: 'impl',
            holderId: 'machine-remote',
            agentId: 'cc',
            expiresAt: '2026-07-01T12:30:00.000Z',
            expired: false,
        }]);

        const close = item.validActions.find((a) => a.action === 'feature-close');
        const reset = item.validActions.find((a) => a.action === 'feature-reset');
        const start = item.validActions.find((a) => a.action === 'feature-start');
        assert.strictEqual(close.disabled, true);
        assert.match(close.disabledReason, /machine-remote/);
        assert.strictEqual(reset.disabled, true);
        assert.strictEqual(start.disabled, undefined);
    } finally {
        if (previousMachineId === undefined) delete process.env.AIGON_MACHINE_ID;
        else process.env.AIGON_MACHINE_ID = previousMachineId;
    }
});

testAsync('assertNoForeignActiveLeases rejects a destructive command when another machine holds a lease', async () => {
    await withTempDirAsync('dash-storage-foreign-lease-', async (base) => {
        const { repo } = initRepoWithBareRemote(base);

        delete require.cache[require.resolve('../../lib/spec-store/index.js')];
        const { createSpecStore, resolveStorageConfig } = require('../../lib/spec-store/index.js');
        const { assertNoForeignActiveLeases } = require('../../lib/spec-store/lease-coordination');
        const store = createSpecStore({ repoPath: repo, storage: resolveStorageConfig(repo) });
        const ref = { entityType: 'feature', entityId: '88' };
        await store.acquireLease(ref, {
            role: 'impl',
            agentId: 'cc',
            holderId: 'machine-remote',
        });

        await assert.rejects(
            () => assertNoForeignActiveLeases(repo, ref, { holderId: 'machine-local' }),
            /held by machine-remote/,
        );
        await assertNoForeignActiveLeases(repo, ref, { holderId: 'machine-remote' });
    });
});

testAsync('rebuildLocalProjection reconciles visible spec path using local repo paths', async () => {
    await withTempDirAsync('dash-storage-projection-reconcile-', async (base) => {
        const { repo } = initRepoWithBareRemote(base);
        const backlogSpec = path.join(repo, 'docs/specs/features/02-backlog/feature-88-storage.md');
        fs.writeFileSync(backlogSpec, '# Feature: storage\n');
        engine.ensureEntityBootstrappedSync(repo, 'feature', '88', 'backlog', backlogSpec, { authorAgentId: 'cc' });
        await engine.startFeature(repo, '88', 'solo_worktree', ['cc']);

        const eventsPath = path.join(repo, '.aigon/workflows/features/88/events.jsonl');
        const events = fs.readFileSync(eventsPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        const inProgressSpec = path.join(repo, 'docs/specs/features/03-in-progress/feature-88-storage.md');
        assert.ok(fs.existsSync(inProgressSpec), 'setup should move spec to in-progress');

        fs.mkdirSync(path.dirname(backlogSpec), { recursive: true });
        fs.renameSync(inProgressSpec, backlogSpec);
        fs.rmSync(path.join(repo, '.aigon/workflows/features/88'), { recursive: true, force: true });

        const { rebuildLocalProjection } = require('../../lib/spec-store/projection');
        await rebuildLocalProjection(repo, { entityType: 'feature', entityId: '88' }, events);

        assert.ok(fs.existsSync(inProgressSpec), 'projection rebuild should reconcile visible spec to in-progress');
        assert.ok(!fs.existsSync(backlogSpec), 'projection rebuild should remove stale backlog spec');
        const docsStatus = execSync('git status --short -- docs/specs/features', {
            cwd: repo,
            encoding: 'utf8',
        }).trim();
        assert.strictEqual(docsStatus, '', 'projection reconciliation should not leave visible spec moves dirty');
    });
});

testAsync('rebuildLocalProjection removes empty projections so backlog specs keep start actions', async () => {
    await withTempDirAsync('dash-storage-empty-projection-', async (base) => {
        const { repo } = initRepoWithBareRemote(base);
        const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-88-storage.md');
        fs.writeFileSync(specPath, '# Feature: storage\n');

        const eventsDir = path.join(repo, '.aigon/workflows/features/88');
        fs.mkdirSync(eventsDir, { recursive: true });
        fs.writeFileSync(path.join(eventsDir, 'events.jsonl'), '');

        const { rebuildLocalProjection } = require('../../lib/spec-store/projection');
        await rebuildLocalProjection(repo, { entityType: 'feature', entityId: '88' }, []);

        assert.ok(!fs.existsSync(eventsDir), 'empty projection directory should be removed');

        clearTierCache(repo);
        const status = collectRepoStatus(repo, { summary: { total: 0 } });
        const feature = (status.features || []).find((f) => String(f.id) === '88');
        assert.ok(feature, 'feature 88 missing from collector');
        assert.strictEqual(feature.stage, 'backlog');
        assert.ok((feature.validActions || []).some((a) => a.action === 'feature-start'), 'backlog feature should retain Start action');
    });
});

report();
