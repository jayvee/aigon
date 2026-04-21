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

report();
