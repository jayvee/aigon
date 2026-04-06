#!/usr/bin/env node
/**
 * Unit tests for lib/pro.js — AIGON_FORCE_PRO env override.
 *
 * REGRESSION: prevents the 2026-04-06 Pro-gate incoherence bug where flipping
 * forcePro in one repo's config produced different Pro states for different
 * code paths in the same dashboard session. The override now lives in an
 * environment variable so the whole process tree agrees.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const PRO_PATH = require.resolve('../../lib/pro.js');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.stack || err.message}`);
        failed++;
    }
}

/**
 * Reload lib/pro.js with a controlled @aigon/pro presence. Returns the
 * fresh module exports. We clear the require cache for pro.js so its
 * top-level `try { require('@aigon/pro') }` runs again under the
 * current require-cache state.
 */
function reloadPro({ proInstalled }) {
    delete require.cache[PRO_PATH];
    // Stub or unstub @aigon/pro in the require cache.
    let proKey;
    try {
        proKey = require.resolve('@aigon/pro');
    } catch {
        proKey = null;
    }
    if (proInstalled) {
        // Inject a fake module entry so the lazy require inside pro.js succeeds.
        const fakeKey = proKey || path.join(__dirname, '__fake_aigon_pro.js');
        require.cache[fakeKey] = {
            id: fakeKey,
            filename: fakeKey,
            loaded: true,
            exports: { __fake: true },
            children: [],
            paths: [],
        };
        // Patch Module._resolveFilename so `require('@aigon/pro')` resolves
        // to our fake key when the package isn't actually installed.
        const Module = require('module');
        if (!Module.__aigonProPatched) {
            const orig = Module._resolveFilename;
            Module._resolveFilename = function (req, ...rest) {
                if (req === '@aigon/pro') return fakeKey;
                return orig.call(this, req, ...rest);
            };
            Module.__aigonProPatched = orig;
        }
    } else {
        // Restore original resolver and clear any fake cache entry.
        const Module = require('module');
        if (Module.__aigonProPatched) {
            Module._resolveFilename = Module.__aigonProPatched;
            delete Module.__aigonProPatched;
        }
        for (const key of Object.keys(require.cache)) {
            if (key.endsWith('__fake_aigon_pro.js')) delete require.cache[key];
        }
    }
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

test('AIGON_FORCE_PRO=false returns false even when @aigon/pro is installed', () => {
    const pro = reloadPro({ proInstalled: true });
    withEnv('false', () => {
        assert.strictEqual(pro.isProAvailable(), false);
    });
});

test('AIGON_FORCE_PRO="0" same as false', () => {
    const pro = reloadPro({ proInstalled: true });
    withEnv('0', () => {
        assert.strictEqual(pro.isProAvailable(), false);
    });
});

test('AIGON_FORCE_PRO=true has no effect — real availability still gates', () => {
    const pro = reloadPro({ proInstalled: false });
    withEnv('true', () => {
        // Pro is not installed → true does NOT manufacture availability.
        assert.strictEqual(pro.isProAvailable(), false);
    });
});

test('AIGON_FORCE_PRO=true returns true when @aigon/pro is installed', () => {
    const pro = reloadPro({ proInstalled: true });
    withEnv('true', () => {
        assert.strictEqual(pro.isProAvailable(), true);
    });
});

test('AIGON_FORCE_PRO unset falls back to package availability (installed)', () => {
    const pro = reloadPro({ proInstalled: true });
    withEnv(undefined, () => {
        assert.strictEqual(pro.isProAvailable(), true);
    });
});

test('AIGON_FORCE_PRO unset falls back to package availability (missing)', () => {
    const pro = reloadPro({ proInstalled: false });
    withEnv(undefined, () => {
        assert.strictEqual(pro.isProAvailable(), false);
    });
});

test('AIGON_FORCE_PRO="garbage" treated as unset / no override', () => {
    const pro = reloadPro({ proInstalled: true });
    withEnv('garbage', () => {
        assert.strictEqual(pro.isProAvailable(), true);
    });
    const proMissing = reloadPro({ proInstalled: false });
    withEnv('garbage', () => {
        assert.strictEqual(proMissing.isProAvailable(), false);
    });
});

test('isProAvailable never reads project config (no loadProjectConfig import)', () => {
    const src = require('fs').readFileSync(PRO_PATH, 'utf8');
    assert.ok(!/loadProjectConfig/.test(src), 'lib/pro.js must not import loadProjectConfig');
    assert.ok(!/require\(['"]\.\/config['"]\)/.test(src), 'lib/pro.js must not require ./config');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
