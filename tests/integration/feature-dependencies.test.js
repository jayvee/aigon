#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    buildDependencyGraph,
    refreshFeatureDependencyGraphs,
} = require('../../lib/feature-dependencies');

function makeFeaturePaths(root) {
    const folders = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
    for (const folder of folders) {
        fs.mkdirSync(path.join(root, folder), { recursive: true });
    }
    return { root, folders };
}

// REGRESSION: feature 303 extracted dependency helpers from entity.js, but the
// legacy two-argument callers still need buildDependencyGraph(paths, utils) and
// refreshFeatureDependencyGraphs(paths, { safeWriteWithStatus }) to keep working.
test('feature dependency helpers stay backward-compatible with old caller signatures', () => withTempDir('aigon-feature-deps-', (root) => {
    const featurePaths = makeFeaturePaths(root);
    const depPath = path.join(root, '02-backlog', 'feature-01-core-graph.md');
    const featurePath = path.join(root, '02-backlog', 'feature-02-api-layer.md');

    fs.writeFileSync(depPath, [
        '---',
        'title: Core Graph',
        '---',
        '',
        '# Core Graph',
        '',
    ].join('\n'));
    fs.writeFileSync(featurePath, [
        '---',
        'title: API Layer',
        'depends_on: [core-graph]',
        '---',
        '',
        '# API Layer',
        '',
    ].join('\n'));

    const graph = buildDependencyGraph(featurePaths, {});
    assert.deepStrictEqual(graph.get('02'), ['01']);

    const result = refreshFeatureDependencyGraphs(featurePaths, {
        safeWriteWithStatus() {},
    });
    assert.strictEqual(result.changedSpecs, 2);
    const updated = fs.readFileSync(featurePath, 'utf8');
    assert.ok(updated.includes('## Dependency Graph'));
    assert.ok(updated.includes('Feature dependency graph for feature 02'));
}));

// REGRESSION: done specs and completed-set members are immutable read surfaces;
// rebuilding their embedded SVG blocks is pure overhead on prioritise/start/close.
test('refreshFeatureDependencyGraphs skips done features and completed set members', () => withTempDir('aigon-feature-deps-skip-', (root) => {
    const featurePaths = makeFeaturePaths(root);
    const donePath = path.join(root, '05-done', 'feature-01-closed.md');
    const activeDepPath = path.join(root, '02-backlog', 'feature-02-core-graph.md');
    const activePath = path.join(root, '02-backlog', 'feature-03-api-layer.md');

    fs.writeFileSync(donePath, '---\nset: ship-it\n---\n\n# Closed\n');
    fs.writeFileSync(activeDepPath, '---\nset: ship-it\n---\n\n# Core Graph\n');
    fs.writeFileSync(activePath, [
        '---',
        'set: ship-it',
        'depends_on: [core-graph]',
        '---',
        '',
        '# API Layer',
        '',
    ].join('\n'));

    const result = refreshFeatureDependencyGraphs(featurePaths, {
        safeWriteWithStatus() {},
    });
    assert.strictEqual(result.changedSpecs, 2);
    assert.ok(!fs.readFileSync(donePath, 'utf8').includes('## Dependency Graph'));
    assert.ok(fs.readFileSync(activePath, 'utf8').includes('## Dependency Graph'));
}));

report();
