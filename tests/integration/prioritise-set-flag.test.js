#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const { readSetMembership, getAllKnownSets, topoSort } = require('../../lib/feature-deps');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function initRepo(root) {
    execFileSync('git', ['init'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    fs.writeFileSync(path.join(root, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: init'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
}

function mkSpecRoot(root) {
    const specRoot = path.join(root, 'docs', 'specs', 'features');
    FOLDERS.forEach(f => fs.mkdirSync(path.join(specRoot, f), { recursive: true }));
    return specRoot;
}

function writeInboxSpec(specRoot, slug, { set, set_lead, depends_on } = {}) {
    const lines = ['---', 'complexity: low'];
    if (set) lines.push(`set: ${set}`);
    if (set_lead) lines.push('set_lead: true');
    lines.push('---', '', `# Feature: ${slug}`, '', '## Dependencies', '');
    lines.push(depends_on ? `depends_on: ${depends_on}` : 'depends_on: none');
    lines.push('');
    fs.writeFileSync(path.join(specRoot, '01-inbox', `feature-${slug}.md`), lines.join('\n'));
}

function runCli(root, args) {
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    const r = spawnSync('node', [cli, ...args], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
    });
    return { stdout: r.stdout || '', stderr: r.stderr || '', code: r.status ?? 1 };
}

// ---------------------------------------------------------------------------
// Unit: readSetMembership
// ---------------------------------------------------------------------------

test('readSetMembership: no frontmatter returns null set', () => {
    const { set, set_lead } = readSetMembership('# Feature\n\nbody');
    assert.strictEqual(set, null);
    assert.strictEqual(set_lead, false);
});

test('readSetMembership: reads set and set_lead', () => {
    const content = '---\ncomplexity: low\nset: my-set\nset_lead: true\n---\n\n# F';
    const { set, set_lead } = readSetMembership(content);
    assert.strictEqual(set, 'my-set');
    assert.strictEqual(set_lead, true);
});

test('readSetMembership: set_lead defaults to false when absent', () => {
    const content = '---\nset: other-set\n---\n\n# F';
    const { set, set_lead } = readSetMembership(content);
    assert.strictEqual(set, 'other-set');
    assert.strictEqual(set_lead, false);
});

// ---------------------------------------------------------------------------
// Unit: topoSort
// ---------------------------------------------------------------------------

test('topoSort: single spec with no deps', () => {
    const specs = [{ slug: 'alpha', set_lead: false, deps: [] }];
    const { sorted, cycle } = topoSort(specs);
    assert.deepStrictEqual(sorted, ['alpha']);
    assert.strictEqual(cycle, null);
});

test('topoSort: linear chain A <- B <- C produces A, B, C', () => {
    // B depends on A, C depends on B
    const specs = [
        { slug: 'c-feature', set_lead: false, deps: ['b-feature'] },
        { slug: 'a-feature', set_lead: false, deps: [] },
        { slug: 'b-feature', set_lead: false, deps: ['a-feature'] },
    ];
    const { sorted, cycle } = topoSort(specs);
    assert.deepStrictEqual(sorted, ['a-feature', 'b-feature', 'c-feature']);
    assert.strictEqual(cycle, null);
});

test('topoSort: set_lead ranks before alphabetical peer', () => {
    const specs = [
        { slug: 'zebra', set_lead: false, deps: [] },
        { slug: 'alpha', set_lead: true, deps: [] },
    ];
    const { sorted, cycle } = topoSort(specs);
    assert.strictEqual(sorted[0], 'alpha', 'set_lead spec should come first');
    assert.deepStrictEqual(sorted, ['alpha', 'zebra']);
    assert.strictEqual(cycle, null);
});

test('topoSort: alphabetical tie-breaker without set_lead', () => {
    const specs = [
        { slug: 'zebra', set_lead: false, deps: [] },
        { slug: 'apple', set_lead: false, deps: [] },
        { slug: 'mango', set_lead: false, deps: [] },
    ];
    const { sorted, cycle } = topoSort(specs);
    assert.deepStrictEqual(sorted, ['apple', 'mango', 'zebra']);
    assert.strictEqual(cycle, null);
});

test('topoSort: cycle returns sorted=[] and cycle path', () => {
    const specs = [
        { slug: 'aaa', set_lead: false, deps: ['bbb'] },
        { slug: 'bbb', set_lead: false, deps: ['aaa'] },
    ];
    const { sorted, cycle } = topoSort(specs);
    assert.deepStrictEqual(sorted, []);
    assert.ok(Array.isArray(cycle) && cycle.length > 0, 'cycle path should be non-empty');
    assert.ok(cycle.includes('aaa') && cycle.includes('bbb'), 'cycle should name both nodes');
});

test('topoSort: cross-set external dep is ignored in ordering', () => {
    // c-feature depends on an external slug not in this array
    const specs = [
        { slug: 'c-feature', set_lead: false, deps: ['external-parent'] },
        { slug: 'a-feature', set_lead: false, deps: [] },
    ];
    const { sorted, cycle } = topoSort(specs);
    assert.strictEqual(cycle, null);
    assert.deepStrictEqual(sorted, ['a-feature', 'c-feature']);
});

// ---------------------------------------------------------------------------
// Unit: getAllKnownSets
// ---------------------------------------------------------------------------

test('getAllKnownSets: returns empty when no specs have set:', () => withTempDir('aigon-sets-', (root) => {
    const specRoot = path.join(root, 'docs', 'specs', 'features');
    fs.mkdirSync(path.join(specRoot, '01-inbox'), { recursive: true });
    fs.writeFileSync(path.join(specRoot, '01-inbox', 'feature-no-set.md'), '---\ncomplexity: low\n---\n\n# F\n');
    const sets = getAllKnownSets(specRoot);
    assert.deepStrictEqual(sets, []);
}));

test('getAllKnownSets: returns sorted distinct sets from inbox and backlog', () => withTempDir('aigon-sets-', (root) => {
    const specRoot = path.join(root, 'docs', 'specs', 'features');
    fs.mkdirSync(path.join(specRoot, '01-inbox'), { recursive: true });
    fs.mkdirSync(path.join(specRoot, '02-backlog'), { recursive: true });
    fs.writeFileSync(path.join(specRoot, '01-inbox', 'feature-a.md'), '---\nset: beta-set\n---\n\n# A\n');
    fs.writeFileSync(path.join(specRoot, '02-backlog', 'feature-01-b.md'), '---\nset: alpha-set\n---\n\n# B\n');
    const sets = getAllKnownSets(specRoot);
    assert.deepStrictEqual(sets, ['alpha-set', 'beta-set']);
}));

// ---------------------------------------------------------------------------
// Integration: --set prioritises in toposort order
// ---------------------------------------------------------------------------

test('feature-prioritise --set prioritises three specs in dep order', () => withTempDir('aigon-set-prio-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);

    // foundation <- middle <- top
    writeInboxSpec(specRoot, 'foundation', { set: 'test-set', set_lead: true });
    writeInboxSpec(specRoot, 'middle', { set: 'test-set', depends_on: 'foundation' });
    writeInboxSpec(specRoot, 'top', { set: 'test-set', depends_on: 'middle' });

    const result = runCli(root, ['feature-prioritise', '--set', 'test-set', '--yes']);
    assert.strictEqual(result.code, 0, `Expected exit 0: ${result.stdout}${result.stderr}`);

    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog')).sort();
    assert.ok(backlog.some(f => f.includes('foundation')), 'foundation must be in backlog');
    assert.ok(backlog.some(f => f.includes('middle')), 'middle must be in backlog');
    assert.ok(backlog.some(f => f.includes('top')), 'top must be in backlog');

    // IDs must be assigned in topological order: foundation < middle < top
    const ids = {};
    for (const f of backlog) {
        const m = f.match(/^feature-(\d+)-(.+)\.md$/);
        if (m) ids[m[2]] = parseInt(m[1], 10);
    }
    assert.ok(ids.foundation < ids.middle, `foundation ID (${ids.foundation}) must be < middle ID (${ids.middle})`);
    assert.ok(ids.middle < ids.top, `middle ID (${ids.middle}) must be < top ID (${ids.top})`);
}));

// ---------------------------------------------------------------------------
// Integration: cycle is detected, no specs move
// ---------------------------------------------------------------------------

test('feature-prioritise --set exits non-zero and moves nothing when cycle detected', () => withTempDir('aigon-set-cycle-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);

    writeInboxSpec(specRoot, 'aaa', { set: 'cycle-set', depends_on: 'bbb' });
    writeInboxSpec(specRoot, 'bbb', { set: 'cycle-set', depends_on: 'aaa' });

    const result = runCli(root, ['feature-prioritise', '--set', 'cycle-set', '--yes']);
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero on cycle');
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('Circular'), `Cycle error message missing: ${combined}`);

    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.strictEqual(backlog.length, 0, 'No specs should be in backlog after cycle detection');
}));

// ---------------------------------------------------------------------------
// Integration: --all-sets processes two distinct sets
// ---------------------------------------------------------------------------

test('feature-prioritise --all-sets prioritises each set in toposort order', () => withTempDir('aigon-all-sets-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);

    // Set alpha: two specs, alpha-base <- alpha-child
    writeInboxSpec(specRoot, 'alpha-base', { set: 'alpha', set_lead: true });
    writeInboxSpec(specRoot, 'alpha-child', { set: 'alpha', depends_on: 'alpha-base' });

    // Set beta: one standalone spec
    writeInboxSpec(specRoot, 'beta-standalone', { set: 'beta' });

    const result = runCli(root, ['feature-prioritise', '--all-sets', '--yes']);
    assert.strictEqual(result.code, 0, `Expected exit 0: ${result.stdout}${result.stderr}`);

    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.ok(backlog.some(f => f.includes('alpha-base')), 'alpha-base must be in backlog');
    assert.ok(backlog.some(f => f.includes('alpha-child')), 'alpha-child must be in backlog');
    assert.ok(backlog.some(f => f.includes('beta-standalone')), 'beta-standalone must be in backlog');

    // alpha-base ID must be lower than alpha-child
    const ids = {};
    for (const f of backlog) {
        const m = f.match(/^feature-(\d+)-(.+)\.md$/);
        if (m) ids[m[2]] = parseInt(m[1], 10);
    }
    assert.ok(ids['alpha-base'] < ids['alpha-child'],
        `alpha-base (${ids['alpha-base']}) must come before alpha-child (${ids['alpha-child']})`);
}));

// ---------------------------------------------------------------------------
// Integration: --dry-run prints plan without moving specs
// ---------------------------------------------------------------------------

test('feature-prioritise --set --dry-run prints plan without moving specs', () => withTempDir('aigon-dry-run-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);

    writeInboxSpec(specRoot, 'dry-a', { set: 'dry-set' });
    writeInboxSpec(specRoot, 'dry-b', { set: 'dry-set', depends_on: 'dry-a' });

    const result = runCli(root, ['feature-prioritise', '--set', 'dry-set', '--dry-run']);
    assert.strictEqual(result.code, 0, `Expected exit 0: ${result.stdout}${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('dry-run'), `dry-run notice missing: ${combined}`);

    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.strictEqual(backlog.length, 0, 'No specs should be moved in dry-run mode');
}));

// ---------------------------------------------------------------------------
// Integration: unknown set exits non-zero with known-sets hint
// ---------------------------------------------------------------------------

test('feature-prioritise --set unknown-set exits non-zero with known sets listed', () => withTempDir('aigon-unknown-set-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);

    writeInboxSpec(specRoot, 'some-feature', { set: 'real-set' });

    const result = runCli(root, ['feature-prioritise', '--set', 'ghost-set', '--yes']);
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero for unknown set');
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('ghost-set') || combined.includes('No inbox'), `Error missing set name: ${combined}`);
}));

// ---------------------------------------------------------------------------
// Regression: existing single-slug behaviour unchanged
// ---------------------------------------------------------------------------

test('feature-prioritise <slug> still works as before', () => withTempDir('aigon-single-slug-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);

    writeInboxSpec(specRoot, 'standalone');

    const result = runCli(root, ['feature-prioritise', 'standalone']);
    assert.strictEqual(result.code, 0, `Expected exit 0: ${result.stdout}${result.stderr}`);
    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.ok(backlog.some(f => f.includes('standalone')), 'standalone must be in backlog');
}));

report();
