#!/usr/bin/env node
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { test, report } = require('../_helpers');
// REGRESSION: keep the GA4 placeholder leak and Pro env/config drift covered even under the hard LOC budget.
test('static guards: home.html stays GA4-free and lib/pro.js ignores project config', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../site/public/home.html'), 'utf8');
    const pro = fs.readFileSync(require.resolve('../../lib/pro.js'), 'utf8');
    assert.ok(!html.includes('G-XXXXXXXXXX') && !html.includes('googletagmanager.com'));
    assert.ok(!/loadProjectConfig|require\(['"]\.\/config['"]\)/.test(pro));
});
// REGRESSION: F286 mode-conditional implementation logs (fleet-only + skip copy).
test('implementation logging policy', () => {
    const pp = require('../../lib/profile-placeholders');
    assert.strictEqual(pp.resolveImplementationLogVariant('drive', undefined), 'skip');
    assert.strictEqual(pp.resolveImplementationLogVariant('drive', 'always'), 'full');
    assert.strictEqual(pp.shouldWriteImplementationLogStarter({ mode: 'drive', loggingLevel: 'fleet-only' }), false);
    const r = pp.resolveLoggingPlaceholders('full', { implementationLogMode: 'drive', loggingLevel: 'fleet-only', projectConfig: {} });
    assert.ok(r.LOGGING_SECTION.includes('No implementation log'));
});
// REGRESSION: feature 307 bans blanket staging in aigon-owned commit paths.
test('aigon-owned commit paths avoid git add -A and git add .', () => {
    const repoRoot = path.join(__dirname, '../..');
    ['lib/feature-close.js', 'lib/worktree.js', 'lib/commands/setup.js'].forEach(relPath => {
        const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
        assert.ok(!content.includes('git add -A'));
        assert.ok(!/git add \.(?:["'`\s]|$)/.test(content));
    });
});
report();
