#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { getSpecPathForEntity, getSpecStateDirForEntity } = require('../../lib/workflow-core/paths');

const STAGES = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
const seed = (repo, kind = 'features') => STAGES.forEach((dir) => fs.mkdirSync(path.join(repo, 'docs', 'specs', kind, dir), { recursive: true }));
const write = (repo, dir, file) => fs.writeFileSync(path.join(repo, 'docs', 'specs', 'features', dir, file), '# spec\n');
const rel = (...parts) => path.join(...parts);

test('single visible match keeps basename in lifecycle dir', () => withTempDir('aigon-paths-', (repo) => {
    seed(repo); write(repo, '02-backlog', 'feature-07-alpha.md');
    assert.strictEqual(getSpecPathForEntity(repo, 'feature', '7', 'backlog'), rel(repo, 'docs', 'specs', 'features', '02-backlog', 'feature-07-alpha.md'));
}));

test('duplicate matches use snapshot specPath as the basename hint', () => withTempDir('aigon-paths-', (repo) => {
    seed(repo); write(repo, '02-backlog', 'feature-07-alpha.md'); write(repo, '05-done', 'feature-07-beta.md');
    const snapshot = { specPath: rel(repo, 'docs', 'specs', 'features', '02-backlog', 'feature-07-alpha.md') };
    assert.strictEqual(getSpecPathForEntity(repo, 'feature', '7', 'implementing', { snapshot }), rel(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-07-alpha.md'));
}));

test('duplicate matches without a snapshot hint throw a stable error', () => withTempDir('aigon-paths-', (repo) => {
    seed(repo); write(repo, '02-backlog', 'feature-07-alpha.md'); write(repo, '05-done', 'feature-07-beta.md');
    assert.throws(() => getSpecPathForEntity(repo, 'feature', '7', 'implementing'), /Spec path resolution failed for feature#7: duplicate-matches-no-snapshot-hint\. matches=/);
}));

test('duplicate matches with a stale snapshot hint throw a stable error', () => withTempDir('aigon-paths-', (repo) => {
    seed(repo); write(repo, '02-backlog', 'feature-07-alpha.md'); write(repo, '05-done', 'feature-07-beta.md');
    const snapshot = { specPath: rel(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-07-gamma.md') };
    assert.throws(() => getSpecPathForEntity(repo, 'feature', '7', 'implementing', { snapshot }), /Spec path resolution failed for feature#7: duplicate-matches-snapshot-mismatch\. snapshotSpecPath=/);
}));

test('missing visible specs still fall back to the padded id file', () => withTempDir('aigon-paths-', (repo) => {
    seed(repo);
    assert.strictEqual(getSpecPathForEntity(repo, 'feature', '7', 'backlog'), rel(repo, 'docs', 'specs', 'features', '02-backlog', '07.md'));
}));

test('unknown lifecycle throws instead of targeting workflow junk dirs', () => withTempDir('aigon-paths-', (repo) => {
    seed(repo);
    assert.throws(() => getSpecStateDirForEntity(repo, 'feature', 'mystery'), /Spec path resolution failed for feature#unknown: unknown-lifecycle\. lifecycle="mystery"; add it to LIFECYCLE_TO_FEATURE_DIR/);
}));

report();
