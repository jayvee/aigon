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
report();
