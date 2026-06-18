#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, testAsync, withTempDirAsync, report, initGitRepo, seedEntityDirs } = require('../_helpers');
const {
    createFeatureForFinding,
    resolveFeatureSlugs,
} = require('../../lib/commands/security-scan');

const SAMPLE_FINDING = {
    severity: 'HIGH',
    tool: 'semgrep',
    category: 'xss',
    file: 'src/auth/login.js',
    line: 42,
    message: 'unsafe innerHTML assignment',
    fingerprint: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
};

test('resolveFeatureSlugs: prioritise slug matches feature-create slug', () => {
    // REGRESSION: 2026-06-18 scan filed inbox specs but prioritise used a different slug.
    const { displayName, createSlug, legacySlug } = resolveFeatureSlugs(SAMPLE_FINDING);
    assert.strictEqual(displayName, 'Remediate xss in login.js');
    assert.notStrictEqual(createSlug, legacySlug);
    assert.strictEqual(createSlug, 'remediate-xss-in-login-js');
});

testAsync('createFeatureForFinding: prioritise failure never reports created ID', async () => {
    // REGRESSION: partial filing must not surface feature-null as success.
    await withTempDirAsync('aigon-sec-scan-fail-', async (root) => {
        initGitRepo(root);
        seedEntityDirs(root, 'features');

        const inboxSlug = resolveFeatureSlugs(SAMPLE_FINDING).createSlug;
        const calls = [];
        const result = await createFeatureForFinding(root, SAMPLE_FINDING, '.scan/reports/2026-06-18.md', {
            runAigonCommand: (repoPath, args) => {
                calls.push(args);
                if (args[0] === 'feature-create') return { status: 0 };
                if (args[0] === 'feature-prioritise') {
                    throw new Error('feature-prioritise: unprioritized feature not found');
                }
                throw new Error(`unexpected command: ${args.join(' ')}`);
            },
        });

        assert.strictEqual(result.failed, true);
        assert.strictEqual(result.step, 'feature-prioritise');
        assert.ok(!result.created, 'must not mark created after prioritise failure');
        assert.strictEqual(result.id, undefined);
        assert.deepStrictEqual(calls[1], ['feature-prioritise', inboxSlug]);
    });
});

testAsync('createFeatureForFinding: re-locate failure never reports created ID', async () => {
    await withTempDirAsync('aigon-sec-scan-reloc-', async (root) => {
        initGitRepo(root);
        seedEntityDirs(root, 'features');

        const result = await createFeatureForFinding(root, SAMPLE_FINDING, null, {
            runAigonCommand: (repoPath, args) => {
                if (args[0] === 'feature-create' || args[0] === 'feature-prioritise') return { status: 0 };
                throw new Error(`unexpected command: ${args.join(' ')}`);
            },
        });

        assert.strictEqual(result.failed, true);
        assert.strictEqual(result.step, 're-locate');
        assert.ok(!result.created);
        assert.strictEqual(result.id, undefined);
    });
});

report();
