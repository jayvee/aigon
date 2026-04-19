#!/usr/bin/env node
// REGRESSION 2026-04-06: Pro-gate incoherence — flipping forcePro in project
// config produced different Pro states for different code paths in the same
// dashboard process. Override now lives in AIGON_FORCE_PRO (env var propagates
// to whole process tree) and lib/pro.js MUST NOT read project config.
'use strict';
const assert = require('assert');
const fs = require('fs');
const { test, report } = require('../_helpers');
const PRO_PATH = require.resolve('../../lib/pro.js');
const reloadPro = () => { delete require.cache[PRO_PATH]; return require('../../lib/pro.js'); };
test('AIGON_FORCE_PRO=false|0 forces isProAvailable()=false', () => {
    const pro = reloadPro(); const prev = process.env.AIGON_FORCE_PRO;
    try { for (const v of ['false', '0']) { process.env.AIGON_FORCE_PRO = v; assert.strictEqual(pro.isProAvailable(), false); } }
    finally { if (prev === undefined) delete process.env.AIGON_FORCE_PRO; else process.env.AIGON_FORCE_PRO = prev; }
});
test('lib/pro.js does not read project config', () => {
    const src = fs.readFileSync(PRO_PATH, 'utf8');
    assert.ok(!/loadProjectConfig|require\(['"]\.\/config['"]\)/.test(src));
});
report();
