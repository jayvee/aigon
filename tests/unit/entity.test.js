#!/usr/bin/env node
'use strict';

/**
 * Unit tests for lib/entity.js dependency helpers
 * Run: node lib/entity.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildFeatureIndex,
    resolveDepRef,
    detectCycle,
    rewriteDependsOn,
} = require('../../lib/entity');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'entity-test-'));
}

function createFeatureSpec(rootDir, folder, filename, frontmatter = '') {
    const dir = path.join(rootDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const content = frontmatter
        ? `---\n${frontmatter}\n---\n\n# Feature\n`
        : `# Feature\n`;
    fs.writeFileSync(path.join(dir, filename), content);
}

const PATHS_CONFIG = (root) => ({
    root,
    folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done'],
    prefix: 'feature',
});

// Minimal utils mock for buildDependencyGraph and rewriteDependsOn
const { parseFrontMatter, modifySpecFile } = require('../../lib/utils');
const mockUtils = { parseFrontMatter, modifySpecFile };

// ---------------------------------------------------------------------------
// Tests: buildFeatureIndex
// ---------------------------------------------------------------------------

console.log('\nbuildFeatureIndex');

test('indexes features by padded ID, unpadded ID, and slug', () => {
    const tmp = makeTmpDir();
    createFeatureSpec(tmp, '02-backlog', 'feature-05-dark-mode.md');
    createFeatureSpec(tmp, '03-in-progress', 'feature-12-auth-system.md');
    const idx = buildFeatureIndex(PATHS_CONFIG(tmp));

    assert.strictEqual(idx.byId['05'].paddedId, '05');
    assert.strictEqual(idx.byId['5'].paddedId, '05');
    assert.strictEqual(idx.bySlug['dark-mode'].paddedId, '05');
    assert.strictEqual(idx.byId['12'].paddedId, '12');
    assert.strictEqual(idx.bySlug['auth-system'].paddedId, '12');
    fs.rmSync(tmp, { recursive: true });
});

test('ignores non-feature files', () => {
    const tmp = makeTmpDir();
    createFeatureSpec(tmp, '02-backlog', 'feature-05-dark-mode.md');
    createFeatureSpec(tmp, '02-backlog', 'notes.md');
    createFeatureSpec(tmp, '02-backlog', 'research-10-api.md');
    const idx = buildFeatureIndex(PATHS_CONFIG(tmp));

    assert.strictEqual(Object.keys(idx.bySlug).length, 1);
    fs.rmSync(tmp, { recursive: true });
});

// ---------------------------------------------------------------------------
// Tests: resolveDepRef
// ---------------------------------------------------------------------------

console.log('\nresolveDepRef');

test('resolves numeric ID (padded)', () => {
    const idx = { byId: { '05': { paddedId: '05' } }, bySlug: {} };
    assert.strictEqual(resolveDepRef('05', idx), '05');
});

test('resolves numeric ID (unpadded)', () => {
    const idx = { byId: { '05': { paddedId: '05' }, '5': { paddedId: '05' } }, bySlug: {} };
    assert.strictEqual(resolveDepRef(5, idx), '05');
});

test('resolves slug reference', () => {
    const idx = { byId: {}, bySlug: { 'dark-mode': { paddedId: '05' } } };
    assert.strictEqual(resolveDepRef('dark-mode', idx), '05');
});

test('returns null for non-existent ref', () => {
    const idx = { byId: {}, bySlug: {} };
    assert.strictEqual(resolveDepRef('999', idx), null);
    assert.strictEqual(resolveDepRef('nonexistent', idx), null);
});

// ---------------------------------------------------------------------------
// Tests: detectCycle
// ---------------------------------------------------------------------------

console.log('\ndetectCycle');

test('returns null for acyclic graph', () => {
    const graph = new Map();
    graph.set('01', ['02']);
    graph.set('02', ['03']);
    graph.set('03', []);
    assert.strictEqual(detectCycle(graph), null);
});

test('returns null for empty graph', () => {
    assert.strictEqual(detectCycle(new Map()), null);
});

test('detects simple two-node cycle', () => {
    const graph = new Map();
    graph.set('01', ['02']);
    graph.set('02', ['01']);
    const cycle = detectCycle(graph);
    assert.ok(cycle, 'Expected a cycle');
    assert.ok(cycle.length >= 3, 'Cycle path should have at least 3 entries');
    // Cycle should start and end with same node
    assert.strictEqual(cycle[0], cycle[cycle.length - 1]);
});

test('detects three-node cycle and shows path', () => {
    const graph = new Map();
    graph.set('01', ['02']);
    graph.set('02', ['03']);
    graph.set('03', ['01']);
    const cycle = detectCycle(graph);
    assert.ok(cycle, 'Expected a cycle');
    assert.strictEqual(cycle[0], cycle[cycle.length - 1]);
    // All three nodes should be in the cycle
    assert.ok(cycle.includes('01'));
    assert.ok(cycle.includes('02'));
    assert.ok(cycle.includes('03'));
});

test('detects self-referencing cycle', () => {
    const graph = new Map();
    graph.set('01', ['01']);
    const cycle = detectCycle(graph);
    assert.ok(cycle, 'Expected a cycle');
    assert.strictEqual(cycle[0], '01');
    assert.strictEqual(cycle[cycle.length - 1], '01');
});

test('handles graph with disconnected components (one cyclic)', () => {
    const graph = new Map();
    graph.set('01', ['02']);
    graph.set('02', []);       // acyclic component
    graph.set('10', ['11']);
    graph.set('11', ['10']);   // cyclic component
    const cycle = detectCycle(graph);
    assert.ok(cycle, 'Expected a cycle in the cyclic component');
});

// ---------------------------------------------------------------------------
// Tests: rewriteDependsOn
// ---------------------------------------------------------------------------

console.log('\nrewriteDependsOn');

test('rewrites depends_on with canonical IDs', () => {
    const tmp = makeTmpDir();
    const specPath = path.join(tmp, 'feature-10-test.md');
    fs.writeFileSync(specPath, `---\ndepends_on: [5, dark-mode]\n---\n\n# Feature\n`);
    rewriteDependsOn(specPath, ['05', '07'], mockUtils);
    const result = fs.readFileSync(specPath, 'utf8');
    assert.ok(result.includes('depends_on: [05, 07]'), `Expected canonical IDs, got: ${result}`);
    fs.rmSync(tmp, { recursive: true });
});

test('preserves other frontmatter fields', () => {
    const tmp = makeTmpDir();
    const specPath = path.join(tmp, 'feature-10-test.md');
    fs.writeFileSync(specPath, `---\ntitle: Test Feature\ndepends_on: [1]\npriority: high\n---\n\n# Feature\n`);
    rewriteDependsOn(specPath, ['01'], mockUtils);
    const result = fs.readFileSync(specPath, 'utf8');
    assert.ok(result.includes('title: Test Feature'), 'title should be preserved');
    assert.ok(result.includes('priority: high'), 'priority should be preserved');
    assert.ok(result.includes('depends_on: [01]'), 'depends_on should be canonical');
    fs.rmSync(tmp, { recursive: true });
});

test('preserves markdown body after frontmatter', () => {
    const tmp = makeTmpDir();
    const specPath = path.join(tmp, 'feature-10-test.md');
    const body = '\n# Feature\n\n## Summary\nSome content here.\n';
    fs.writeFileSync(specPath, `---\ndepends_on: [5]\n---\n${body}`);
    rewriteDependsOn(specPath, ['05'], mockUtils);
    const result = fs.readFileSync(specPath, 'utf8');
    assert.ok(result.includes('## Summary'), 'Body should be preserved');
    assert.ok(result.includes('Some content here.'), 'Body content should be preserved');
    fs.rmSync(tmp, { recursive: true });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
