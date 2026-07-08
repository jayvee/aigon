#!/usr/bin/env node
'use strict';

// REGRESSION F602: sandbox preview provisions isolated AIGON_HOME + seeded fixture via shared helper.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');
const {
    provisionEphemeralSeededInstance,
    destroyEphemeralSeededInstance,
} = require('../../lib/ephemeral-seeded-instance');
const {
    writeSandboxState,
    readSandboxState,
    removeSandboxState,
} = require('../../lib/preview-sandbox');
const { resolveSandboxFixture, gcPreviewSandboxes } = require('../../lib/preview-launcher');

test('resolveSandboxFixture defaults to brewboard and accepts named fixtures', () => {
    assert.strictEqual(resolveSandboxFixture(true), 'brewboard');
    assert.strictEqual(resolveSandboxFixture('empty'), 'empty');
    assert.strictEqual(resolveSandboxFixture(false), null);
});

test('provisionEphemeralSeededInstance creates isolated home and empty fixture repo', () => withTempDir('aigon-f602-ephemeral-', (_tmp) => {
    const instance = provisionEphemeralSeededInstance({
        fixture: 'empty',
        repoPrefix: 'repo-',
        homePrefix: 'home-',
    });
    try {
        assert.ok(fs.existsSync(instance.tempHome));
        assert.ok(fs.existsSync(instance.repoPath));
        assert.ok(fs.existsSync(path.join(instance.tempHome, '.aigon', 'config.json')));
        const cfg = JSON.parse(fs.readFileSync(path.join(instance.tempHome, '.aigon', 'config.json'), 'utf8'));
        assert.deepStrictEqual(cfg.repos, [instance.repoPath]);
        assert.ok(fs.existsSync(path.join(instance.repoPath, 'docs', 'specs', 'features', '01-inbox')));
    } finally {
        destroyEphemeralSeededInstance(instance);
        assert.ok(!fs.existsSync(instance.tempHome));
        assert.ok(!fs.existsSync(instance.repoPath));
    }
}));

testAsync('preview sandbox registry round-trips and gc removes dead entries', async () => withTempDirAsync('aigon-f602-sandbox-', async (tmp) => {
    const prevHome = process.env.HOME;
    process.env.HOME = tmp;
    try {
        const deadHome = path.join(tmp, 'dead-home');
        const deadRepo = path.join(tmp, 'dead-repo');
        fs.mkdirSync(deadHome, { recursive: true });
        fs.mkdirSync(deadRepo, { recursive: true });
        writeSandboxState('cu-602', { tempHome: deadHome, repoPath: deadRepo, fixture: 'empty' });
        assert.ok(readSandboxState('cu-602'));
        const removed = await gcPreviewSandboxes({ isProcessAlive: () => false });
        assert.strictEqual(removed, 1);
        assert.strictEqual(readSandboxState('cu-602'), null);
        assert.ok(!fs.existsSync(deadHome));
        assert.ok(!fs.existsSync(deadRepo));
    } finally {
        removeSandboxState('cu-602');
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
    }
}));

report();
