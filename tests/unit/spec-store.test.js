#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, report } = require('../_helpers');

const SPEC_STORE_PATH = path.join(__dirname, '../../lib/spec-store/index.js');

function countFsMutations(fn) {
  const counters = { writeFileSync: 0, appendFileSync: 0, mkdirSync: 0, rmSync: 0, renameSync: 0 };
  const originals = {};
  for (const name of Object.keys(counters)) {
    originals[name] = fs[name];
    fs[name] = (...args) => {
      counters[name] += 1;
      return originals[name](...args);
    };
  }
  try {
    fn();
  } finally {
    for (const name of Object.keys(counters)) {
      fs[name] = originals[name];
    }
  }
  return counters;
}

test('require lib/spec-store/index.js performs no filesystem writes', () => {
  // REGRESSION: SpecStore module load must be side-effect free (feature 573 AC).
  delete require.cache[require.resolve(SPEC_STORE_PATH)];
  const counters = countFsMutations(() => {
    require(SPEC_STORE_PATH);
  });
  const total = Object.values(counters).reduce((sum, n) => sum + n, 0);
  assert.strictEqual(total, 0);
});

test('SPEC_STORE_METHODS are all functions on createSpecStore()', () => {
  // REGRESSION: documented interface surface must be complete (feature 573 AC).
  const { createSpecStore, SPEC_STORE_METHODS } = require(SPEC_STORE_PATH);
  const store = createSpecStore({ repoPath: process.cwd() });
  for (const name of SPEC_STORE_METHODS) {
    assert.strictEqual(typeof store[name], 'function', `missing ${name}`);
  }
});

test('spec key format/parse round-trips for F42 and R43', () => {
  // REGRESSION: spec keys must round-trip without coercion (feature 573 AC).
  const { parseSpecKey, formatSpecKey } = require(SPEC_STORE_PATH);
  assert.strictEqual(formatSpecKey(parseSpecKey('F42')), 'F42');
  assert.strictEqual(formatSpecKey(parseSpecKey('R43')), 'R43');
  assert.deepStrictEqual(parseSpecKey('F42'), {
    key: 'F42',
    kind: 'feature',
    letter: 'F',
    number: 42,
  });
});

test('malformed spec keys throw SpecKeyError', () => {
  // REGRESSION: malformed keys must not silently coerce (feature 573 AC).
  const { parseSpecKey, SpecKeyError } = require(SPEC_STORE_PATH);
  for (const bad of ['X1', 'F', '', '   ']) {
    assert.throws(() => parseSpecKey(bad), SpecKeyError);
  }
});

testAsync('sync and health stubs return documented local shape', async () => {
  const { createSpecStore } = require(SPEC_STORE_PATH);
  const store = createSpecStore({ repoPath: process.cwd() });
  assert.deepStrictEqual(await store.sync(), { ok: true, backend: 'local' });
  assert.deepStrictEqual(await store.health(), { ok: true, backend: 'local' });
});

report();
