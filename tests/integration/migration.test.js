#!/usr/bin/env node
'use strict';
// REGRESSION: prevents migration framework from silently losing state on
// failure — the backup/restore cycle must round-trip cleanly (feature 249).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');

function seedWorkflows(dir) {
    const wf = path.join(dir, '.aigon', 'workflows', 'features', '01');
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(path.join(wf, 'snapshot.json'), JSON.stringify({ id: '01', state: 'implementing' }));
    return wf;
}

testAsync('runMigration succeeds and writes manifest + backup', async () => withTempDirAsync(async (dir) => {
    const m = require('../../lib/migration');
    m._internals.migrations.clear();
    seedWorkflows(dir);
    const result = await m.runMigration(dir, '9.0.0', async (ctx) => {
        ctx.log('test migration ran');
    });
    assert.strictEqual(result.status, 'success');
    const manifest = m._internals.readManifest(dir, '9.0.0');
    assert.strictEqual(manifest.status, 'success');
    assert.ok(manifest.entities.features.migrated.includes('01'));
    assert.ok(fs.existsSync(path.join(dir, '.aigon', 'migrations', '9.0.0', 'backup.tar.gz')));
    assert.ok(fs.existsSync(path.join(dir, '.aigon', 'migrations', '9.0.0', 'migration.log')));
}));

testAsync('runMigration restores backup on failure', async () => withTempDirAsync(async (dir) => {
    const m = require('../../lib/migration');
    m._internals.migrations.clear();
    const wf = seedWorkflows(dir);
    const original = fs.readFileSync(path.join(wf, 'snapshot.json'), 'utf8');
    const result = await m.runMigration(dir, '9.1.0', async (ctx) => {
        fs.writeFileSync(path.join(wf, 'snapshot.json'), 'CORRUPTED');
        throw new Error('intentional failure');
    });
    assert.strictEqual(result.status, 'restored');
    assert.strictEqual(fs.readFileSync(path.join(wf, 'snapshot.json'), 'utf8'), original);
}));

testAsync('runMigration rollback removes workflows created from an empty pre-migration state', async () => withTempDirAsync(async (dir) => {
    const m = require('../../lib/migration');
    m._internals.migrations.clear();
    const result = await m.runMigration(dir, '9.1.1', async (ctx) => {
        const wf = path.join(ctx.workflowsDir, 'features', '01');
        fs.mkdirSync(wf, { recursive: true });
        fs.writeFileSync(path.join(wf, 'snapshot.json'), JSON.stringify({ id: '01' }));
        throw new Error('intentional failure');
    });
    assert.strictEqual(result.status, 'restored');
    assert.strictEqual(fs.existsSync(path.join(dir, '.aigon', 'workflows')), false);
}));

testAsync('runMigration is idempotent — skips if already succeeded', async () => withTempDirAsync(async (dir) => {
    const m = require('../../lib/migration');
    m._internals.migrations.clear();
    seedWorkflows(dir);
    await m.runMigration(dir, '9.2.0', async () => {});
    let called = false;
    const result = await m.runMigration(dir, '9.2.0', async () => { called = true; });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(called, false);
}));

testAsync('runPendingMigrations records fromVersion in the manifest', async () => withTempDirAsync(async (dir) => {
    const m = require('../../lib/migration');
    m._internals.migrations.clear();
    seedWorkflows(dir);
    m.registerMigration('9.3.0', async () => {});
    const results = await m.runPendingMigrations(dir, '9.2.0');
    assert.deepStrictEqual(results, [{ version: '9.3.0', status: 'success' }]);
    const manifest = m._internals.readManifest(dir, '9.3.0');
    assert.strictEqual(manifest.fromVersion, '9.2.0');
    assert.strictEqual(manifest.toVersion, '9.3.0');
}));

report();
