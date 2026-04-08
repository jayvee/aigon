#!/usr/bin/env node
/**
 * Unit tests for lib/pro.js — AIGON_FORCE_PRO env override.
 *
 * REGRESSION: prevents the 2026-04-06 Pro-gate incoherence bug where flipping
 * forcePro in one repo's config produced different Pro states for different
 * code paths in the same dashboard session. The override now lives in an
 * environment variable so the whole process tree agrees.
 *
 * Scope note: this file only tests the "Pro IS installed" scenarios, because
 * @aigon/pro is npm-linked on dev machines and the require cache cannot be
 * reliably scrubbed without subprocess isolation. The "Pro NOT installed"
 * scenarios are covered by:
 *   - the OSS smoke test in CLAUDE.md rule T1 (manual, AIGON_FORCE_PRO=false)
 *   - CI runs against environments where @aigon/pro is not linked
 *   - the static-source assertion at the bottom that lib/pro.js doesn't
 *     leak project-config reads
 * Adding subprocess-based mocking just for the "missing" path was rejected
 * as more setup than assertion (see CLAUDE.md rule T3 forbidden patterns).
 */

'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');

const PRO_PATH = require.resolve('../../lib/pro.js');

/** Reload lib/pro.js fresh so its top-level @aigon/pro require runs again. */
function reloadPro() {
    delete require.cache[PRO_PATH];
    return require('../../lib/pro.js');
}

function withEnv(value, fn) {
    const prev = process.env.AIGON_FORCE_PRO;
    if (value === undefined) delete process.env.AIGON_FORCE_PRO;
    else process.env.AIGON_FORCE_PRO = value;
    try { fn(); } finally {
        if (prev === undefined) delete process.env.AIGON_FORCE_PRO;
        else process.env.AIGON_FORCE_PRO = prev;
    }
}

console.log('\n── pro-gate (AIGON_FORCE_PRO env override) ──────────────');

for (const [val, expected] of [
    ['false', false], ['0', false],
    ['true', true], ['1', true], [undefined, true], ['garbage', true],
]) {
    test(`AIGON_FORCE_PRO ${JSON.stringify(val)} → isProAvailable()=${expected}`, () => {
        const pro = reloadPro();
        withEnv(val, () => assert.strictEqual(pro.isProAvailable(), expected));
    });
}

test('isProAvailable never reads project config (static source check)', () => {
    const src = require('fs').readFileSync(PRO_PATH, 'utf8');
    assert.ok(!/loadProjectConfig/.test(src), 'lib/pro.js must not import loadProjectConfig');
    assert.ok(!/require\(['"]\.\/config['"]\)/.test(src), 'lib/pro.js must not require ./config');
});

report();
