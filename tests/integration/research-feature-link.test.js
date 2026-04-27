#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { parseFrontMatter } = require('../../lib/cli-parse');
const featureSets = require('../../lib/feature-sets');
const { collectFeaturesForResearch } = require('../../lib/dashboard-status-collector');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function mkFeatureDirs(root) {
    FOLDERS.forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', 'features', f), { recursive: true }));
}

function writeFeature(root, folder, file, frontmatter) {
    const lines = ['---'];
    Object.entries(frontmatter).forEach(([k, v]) => lines.push(`${k}: ${v}`));
    lines.push('---', '', `# Feature: ${file.replace(/^feature-(\d+-)?/, '').replace(/\.md$/, '')}`, '');
    fs.writeFileSync(path.join(root, 'docs', 'specs', 'features', folder, file), lines.join('\n'));
}

test('parseFrontMatter normalises research: 44 (scalar) to [44]', () => {
    const content = '---\ncomplexity: medium\nresearch: 44\n---\n\n# body\n';
    const { data } = parseFrontMatter(content);
    assert.deepStrictEqual(data.research, [44]);
});

test('parseFrontMatter normalises research: [44, 21] (list) to [44, 21]', () => {
    const content = '---\ncomplexity: medium\nresearch: [44, 21]\n---\n\n# body\n';
    const { data } = parseFrontMatter(content);
    assert.deepStrictEqual(data.research, [44, 21]);
});

test('parseFrontMatter omits research key when absent or empty', () => {
    const empty = parseFrontMatter('---\ncomplexity: medium\n---\n\n# body\n');
    assert.strictEqual(empty.data.research, undefined);
    const blank = parseFrontMatter('---\ncomplexity: medium\nresearch:\n---\n\n# body\n');
    assert.strictEqual(blank.data.research, undefined);
});

test('parseFrontMatter casts string numbers and dedupes ids', () => {
    const content = '---\nresearch: "44"\n---\n';
    const { data } = parseFrontMatter(content);
    assert.deepStrictEqual(data.research, [44]);
    const dup = parseFrontMatter('---\nresearch: [44, 44, 21]\n---\n');
    assert.deepStrictEqual(dup.data.research, [44, 21]);
});

test('readResearchTag returns scalar for one id, array for many, null when missing', () => {
    assert.strictEqual(featureSets.readResearchTag('---\nresearch: 44\n---\n'), 44);
    assert.deepStrictEqual(featureSets.readResearchTag('---\nresearch: [44, 21]\n---\n'), [44, 21]);
    assert.strictEqual(featureSets.readResearchTag('---\ncomplexity: medium\n---\n'), null);
    assert.strictEqual(featureSets.readResearchTag(''), null);
});

test('collectFeaturesForResearch returns features tagged with the matching research id', () => withTempDir('aigon-rfl-', (root) => {
    mkFeatureDirs(root);
    writeFeature(root, '02-backlog', 'feature-100-alpha.md', { complexity: 'medium', set: 'comp', research: 44 });
    writeFeature(root, '03-in-progress', 'feature-101-beta.md', { complexity: 'high', research: 44 });
    writeFeature(root, '02-backlog', 'feature-102-gamma.md', { complexity: 'low', research: 21 });
    writeFeature(root, '02-backlog', 'feature-103-delta.md', { complexity: 'medium' }); // untagged
    writeFeature(root, '02-backlog', 'feature-104-epsilon.md', { complexity: 'low', research: '[44, 21]' });

    const matches = collectFeaturesForResearch(root, 44);
    assert.strictEqual(matches.length, 3);
    const ids = matches.map(m => m.id);
    assert.deepStrictEqual(ids, ['100', '104', '101']); // backlog (numeric asc) then in-progress
    const f100 = matches.find(m => m.id === '100');
    assert.strictEqual(f100.set, 'comp');
    assert.strictEqual(f100.complexity, 'medium');
    assert.strictEqual(f100.stage, 'backlog');
    assert.strictEqual(f100.name, 'alpha');
    assert.ok(f100.specPath.endsWith('feature-100-alpha.md'));
}));

test('collectFeaturesForResearch returns [] for unknown research id and bad inputs', () => withTempDir('aigon-rfl-empty-', (root) => {
    mkFeatureDirs(root);
    writeFeature(root, '02-backlog', 'feature-100-alpha.md', { complexity: 'medium', research: 44 });
    assert.deepStrictEqual(collectFeaturesForResearch(root, 99), []);
    assert.deepStrictEqual(collectFeaturesForResearch(root, 0), []);
    assert.deepStrictEqual(collectFeaturesForResearch(root, 'bad'), []);
}));

report();
