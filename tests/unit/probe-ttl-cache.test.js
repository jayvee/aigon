#!/usr/bin/env node
'use strict';

// Missing coverage: lib/probe-ttl-cache.js — TTL-keyed memoisation used by
// quota-probe and other hot paths that must not call expensive operations on
// every supervisor tick.

const assert = require('assert');
const { test, report } = require('../_helpers');

// Each test gets a fresh module instance to avoid shared-Map state.
function freshCache() {
    const key = require.resolve('../../lib/probe-ttl-cache');
    delete require.cache[key];
    return require('../../lib/probe-ttl-cache');
}

test('getOrCompute: cache miss — calls computeFn and caches result', () => {
    const c = freshCache();
    let calls = 0;
    const v = c.getOrCompute('k', 60000, () => { calls++; return 42; });
    assert.strictEqual(v, 42);
    assert.strictEqual(calls, 1);
});

test('getOrCompute: cache hit within TTL — computeFn not called again', () => {
    const c = freshCache();
    let calls = 0;
    c.getOrCompute('k', 60000, () => { calls++; return 'first'; });
    const v = c.getOrCompute('k', 60000, () => { calls++; return 'second'; });
    assert.strictEqual(v, 'first', 'returns cached value');
    assert.strictEqual(calls, 1, 'computeFn called only once');
});

test('getOrCompute: TTL=0 — every call recomputes (no caching)', () => {
    const c = freshCache();
    let calls = 0;
    c.getOrCompute('k', 0, () => { calls++; return calls; });
    c.getOrCompute('k', 0, () => { calls++; return calls; });
    assert.strictEqual(calls, 2, 'TTL=0 forces recompute on every call');
});

test('clear(key): removes specific key while preserving others', () => {
    const c = freshCache();
    let aCount = 0;
    let bCount = 0;
    c.getOrCompute('a', 60000, () => { aCount++; return 'a'; });
    c.getOrCompute('b', 60000, () => { bCount++; return 'b'; });
    c.clear('a');
    c.getOrCompute('a', 60000, () => { aCount++; return 'a2'; });
    const bVal = c.getOrCompute('b', 60000, () => { bCount++; return 'b2'; });
    assert.strictEqual(aCount, 2, 'a was recomputed after clear');
    assert.strictEqual(bCount, 1, 'b was not evicted');
    assert.strictEqual(bVal, 'b', 'b still returns cached value');
});

test('clear(): full clear — all keys recomputed after clear()', () => {
    const c = freshCache();
    let calls = 0;
    c.getOrCompute('x', 60000, () => { calls++; return 'x'; });
    c.getOrCompute('y', 60000, () => { calls++; return 'y'; });
    c.clear();
    c.getOrCompute('x', 60000, () => { calls++; return 'x'; });
    c.getOrCompute('y', 60000, () => { calls++; return 'y'; });
    assert.strictEqual(calls, 4, 'both keys recomputed after full clear');
});

test('invalidateKeysIncluding: removes matching keys by substring', () => {
    const c = freshCache();
    let aCalls = 0;
    let bCalls = 0;
    c.getOrCompute('repo-a:probe', 60000, () => { aCalls++; return 1; });
    c.getOrCompute('repo-b:probe', 60000, () => { bCalls++; return 2; });
    c.invalidateKeysIncluding('repo-a');
    c.getOrCompute('repo-a:probe', 60000, () => { aCalls++; return 1; });
    c.getOrCompute('repo-b:probe', 60000, () => { bCalls++; return 2; });
    assert.strictEqual(aCalls, 2, 'repo-a key evicted and recomputed');
    assert.strictEqual(bCalls, 1, 'repo-b key unaffected');
});

test('invalidateKeysIncluding: no-op for empty or non-string input', () => {
    const c = freshCache();
    let calls = 0;
    c.getOrCompute('safe', 60000, () => { calls++; return 1; });
    c.invalidateKeysIncluding('');
    c.invalidateKeysIncluding(null);
    c.invalidateKeysIncluding(undefined);
    c.getOrCompute('safe', 60000, () => { calls++; return 2; });
    assert.strictEqual(calls, 1, 'invalid inputs are no-ops — cached value preserved');
});

report();
