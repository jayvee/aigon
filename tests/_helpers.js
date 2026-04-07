'use strict';
/**
 * Shared test runner + temp-dir helpers for tests/integration/*.test.js.
 *
 * Each test file requires this module, calls test() / testAsync() to register
 * cases, and calls report() at the bottom. Sync tests run immediately; async
 * tests are collected and awaited inside report().
 *
 * Module-level state (passed/failed/asyncTests) is per-process — npm test
 * invokes each test file as its own node process so counters never leak
 * across files.
 *
 * REGRESSION: prevents the boilerplate drift identified in the 2026-04-07
 * test audit, where 5 test files each declared their own near-identical
 * test runner (~88 LOC duplicated). Changes to error formatting or async
 * handling now happen in one place.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
const asyncTests = [];

const _ok = (d) => { console.log(`  ✓ ${d}`); passed++; };
const _err = (d, e) => { console.error(`  ✗ ${d}\n    ${e.stack || e.message}`); failed++; };

function test(description, fn) {
    try { fn(); _ok(description); } catch (e) { _err(description, e); }
}

function testAsync(description, fn) {
    asyncTests.push(
        Promise.resolve().then(fn).then(() => _ok(description)).catch((e) => _err(description, e))
    );
}

function _resolvePrefix(prefix, fn) {
    if (typeof prefix === 'function') return [fn || prefix, 'aigon-test-'];
    return [fn, prefix];
}

function withTempDir(prefix, fn) {
    const [body, p] = _resolvePrefix(prefix, fn);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), p));
    try { return body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function withTempDirAsync(prefix, fn) {
    const [body, p] = _resolvePrefix(prefix, fn);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), p));
    try { return await body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function report() {
    if (asyncTests.length > 0) await Promise.all(asyncTests);
    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

module.exports = { test, testAsync, withTempDir, withTempDirAsync, report };
