#!/usr/bin/env node
// REGRESSION feature 249: migration framework must never silently lose state.
// The backup/restore cycle must round-trip cleanly on failure, rollback must
// remove workflows created from an empty pre-state (so retries don't double-
// apply), runs are idempotent by manifest presence, and the manifest must
// record fromVersion so chained migrations can be ordered.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const m = require('../../lib/migration');

function seedWorkflows(dir) {
    const wf = path.join(dir, '.aigon', 'workflows', 'features', '01');
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(path.join(wf, 'snapshot.json'), JSON.stringify({ id: '01', state: 'implementing' }));
    return wf;
}
const reset = () => m._internals.migrations.clear();

testAsync('success writes manifest + backup and tracks migrated entities', () => withTempDirAsync(async (dir) => {
    reset(); seedWorkflows(dir);
    const r = await m.runMigration(dir, '9.0.0', async (ctx) => ctx.log('ran'));
    assert.strictEqual(r.status, 'success');
    const mf = m._internals.readManifest(dir, '9.0.0');
    assert.strictEqual(mf.status, 'success');
    assert.ok(mf.entities.features.migrated.includes('01'));
    assert.ok(fs.existsSync(path.join(dir, '.aigon', 'migrations', '9.0.0', 'backup.tar.gz')));
}));

testAsync('failure restores backup byte-for-byte', () => withTempDirAsync(async (dir) => {
    reset(); const wf = seedWorkflows(dir);
    const original = fs.readFileSync(path.join(wf, 'snapshot.json'), 'utf8');
    const r = await m.runMigration(dir, '9.1.0', async () => {
        fs.writeFileSync(path.join(wf, 'snapshot.json'), 'CORRUPTED');
        throw new Error('intentional failure');
    });
    assert.strictEqual(r.status, 'restored');
    assert.strictEqual(fs.readFileSync(path.join(wf, 'snapshot.json'), 'utf8'), original);
}));

testAsync('failure from empty pre-state removes workflows created during migration', () => withTempDirAsync(async (dir) => {
    reset();
    const r = await m.runMigration(dir, '9.1.1', async (ctx) => {
        const wf = path.join(ctx.workflowsDir, 'features', '01');
        fs.mkdirSync(wf, { recursive: true });
        fs.writeFileSync(path.join(wf, 'snapshot.json'), '{}');
        throw new Error('intentional failure');
    });
    assert.strictEqual(r.status, 'restored');
    assert.strictEqual(fs.existsSync(path.join(dir, '.aigon', 'workflows')), false);
}));

testAsync('successful migration is idempotent on repeat', () => withTempDirAsync(async (dir) => {
    reset(); seedWorkflows(dir);
    await m.runMigration(dir, '9.2.0', async () => {});
    let called = false;
    const r = await m.runMigration(dir, '9.2.0', async () => { called = true; });
    assert.strictEqual(r.status, 'skipped');
    assert.strictEqual(called, false);
}));

testAsync('runPendingMigrations records fromVersion for chain ordering', () => withTempDirAsync(async (dir) => {
    reset(); seedWorkflows(dir);
    m.registerMigration('9.3.0', async () => {});
    const results = await m.runPendingMigrations(dir, '9.2.0');
    assert.deepStrictEqual(results, [{ version: '9.3.0', status: 'success' }]);
    const mf = m._internals.readManifest(dir, '9.3.0');
    assert.strictEqual(mf.fromVersion, '9.2.0');
    assert.strictEqual(mf.toVersion, '9.3.0');
}));

report();
