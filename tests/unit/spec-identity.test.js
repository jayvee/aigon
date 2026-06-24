#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { test, report } = require('../_helpers');

const IDENTITY_PATH = path.join(__dirname, '../../lib/spec-identity.js');

test('parseDisplayKey and formatDisplayKey round-trip F42 and R43', () => {
  // REGRESSION: display keys must round-trip without coercion (feature 575 AC).
  const {
    parseDisplayKey,
    formatDisplayKey,
    buildSpecIdentity,
  } = require(IDENTITY_PATH);
  assert.strictEqual(formatDisplayKey(parseDisplayKey('F42')), 'F42');
  assert.strictEqual(formatDisplayKey(parseDisplayKey('R43')), 'R43');
  assert.deepStrictEqual(buildSpecIdentity({ kind: 'feature', number: 42, slug: 'demo' }), {
    key: 'F42',
    number: 42,
    kind: 'feature',
    slug: 'demo',
    numericId: '42',
  });
});

test('resolveSpecIdentity accepts F42, R43, legacy prefixes, and contextual bare numeric', () => {
  // REGRESSION: single resolver must accept all documented input shapes (feature 575 AC).
  const { resolveSpecIdentity } = require(IDENTITY_PATH);
  assert.deepStrictEqual(resolveSpecIdentity('F42'), {
    key: 'F42', number: 42, kind: 'feature', slug: null, numericId: '42',
  });
  assert.deepStrictEqual(resolveSpecIdentity('R43'), {
    key: 'R43', number: 43, kind: 'research', slug: null, numericId: '43',
  });
  assert.deepStrictEqual(resolveSpecIdentity('feature-42'), {
    key: 'F42', number: 42, kind: 'feature', slug: null, numericId: '42',
  });
  assert.deepStrictEqual(resolveSpecIdentity('research-43'), {
    key: 'R43', number: 43, kind: 'research', slug: null, numericId: '43',
  });
  assert.deepStrictEqual(resolveSpecIdentity('42', { kind: 'feature' }), {
    key: 'F42', number: 42, kind: 'feature', slug: null, numericId: '42',
  });
});

test('bare numeric without kind throws at kind-agnostic call sites', () => {
  // REGRESSION: ambiguous bare numerics must not silently guess kind (feature 575 AC).
  const { resolveSpecIdentity, SpecIdentityError } = require(IDENTITY_PATH);
  assert.throws(() => resolveSpecIdentity('575'), SpecIdentityError, /Ambiguous bare numeric/);
});

test('parseSpecFilename extracts slug from legacy filenames', () => {
  // REGRESSION: filename parsing must preserve legacy feature/research naming (feature 575 AC).
  const { parseSpecFilename } = require(IDENTITY_PATH);
  assert.deepStrictEqual(
    parseSpecFilename('feature-575-repo-wide-spec-identity-keys.md'),
    { kind: 'feature', number: 575, slug: 'repo-wide-spec-identity-keys' }
  );
  assert.deepStrictEqual(
    parseSpecFilename('research-43-topic-slug.md'),
    { kind: 'research', number: 43, slug: 'topic-slug' }
  );
});

report();
