'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyPendingCommitFiles,
} = require('../../lib/close-commit-classify');

describe('classifyPendingCommitFiles', () => {
  // REGRESSION: close auto-commit must flag files never touched on the feature branch.
  it('splits pending paths into related vs stray by feature branch history', () => {
    const touched = new Set(['lib/foo.js', 'docs/specs/features/03-in-progress/feature-01-x.md']);
    const result = classifyPendingCommitFiles(touched, [
      'lib/foo.js',
      'tests/unit/stray.test.js',
      'docs/specs/features/03-in-progress/feature-01-x.md',
    ]);
    assert.deepStrictEqual(result.related, [
      'lib/foo.js',
      'docs/specs/features/03-in-progress/feature-01-x.md',
    ]);
    assert.deepStrictEqual(result.stray, ['tests/unit/stray.test.js']);
  });

  it('treats all pending paths as stray when branch touched set is empty', () => {
    const result = classifyPendingCommitFiles(new Set(), ['tmp/scratch.txt']);
    assert.deepStrictEqual(result.related, []);
    assert.deepStrictEqual(result.stray, ['tmp/scratch.txt']);
  });

  it('treats all pending paths as related when every path was on the branch', () => {
    const touched = ['a.js', 'b.js'];
    const result = classifyPendingCommitFiles(touched, ['a.js', 'b.js']);
    assert.deepStrictEqual(result.stray, []);
    assert.deepStrictEqual(result.related, ['a.js', 'b.js']);
  });
});
