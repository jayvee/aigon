#!/usr/bin/env node
// REGRESSION: prevents the 2026-04-06 Pro-gate incoherence bug where flipping
// forcePro in one repo's config produced different Pro states for different
// code paths in the same dashboard session. The override now lives in an env
// var so the whole process tree agrees, and Pro MUST NOT read project config.
'use strict';

const assert = require('assert');
const fs = require('fs');
const { test, report } = require('../_helpers');

const PRO_PATH = require.resolve('../../lib/pro.js');
const PRO_LINKED = (() => { try { require.resolve('@aigon/pro'); return true; } catch { return false; } })();

function reloadPro() { delete require.cache[PRO_PATH]; return require('../../lib/pro.js'); }
function withEnv(v, fn) {
    const prev = process.env.AIGON_FORCE_PRO;
    if (v === undefined) delete process.env.AIGON_FORCE_PRO; else process.env.AIGON_FORCE_PRO = v;
    try { fn(); } finally { if (prev === undefined) delete process.env.AIGON_FORCE_PRO; else process.env.AIGON_FORCE_PRO = prev; }
}

test('AIGON_FORCE_PRO=false|0 forces isProAvailable()=false regardless of install', () => {
    const pro = reloadPro();
    for (const v of ['false', '0']) withEnv(v, () => assert.strictEqual(pro.isProAvailable(), false));
});

if (PRO_LINKED) {
    test('AIGON_FORCE_PRO=true|1|unset defers to installed Pro', () => {
        const pro = reloadPro();
        for (const v of ['true', '1', undefined, 'garbage']) withEnv(v, () => assert.strictEqual(pro.isProAvailable(), true));
    });
}

test('lib/pro.js must not read project config (prevents per-repo incoherence)', () => {
    const src = fs.readFileSync(PRO_PATH, 'utf8');
    assert.ok(!/loadProjectConfig/.test(src));
    assert.ok(!/require\(['"]\.\/config['"]\)/.test(src));
});

report();
