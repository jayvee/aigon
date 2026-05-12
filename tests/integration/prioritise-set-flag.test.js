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
    const env = { ...process.env, ...GIT_SAFE_ENV };
    for (const args of [['init'], ['config', 'user.email', 'test@aigon.test'], ['config', 'user.name', 'Aigon Test']]) {
        execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
    }
    fs.writeFileSync(path.join(root, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: root, env, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: init'], { cwd: root, env, stdio: 'pipe' });
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
    fs.writeFileSync(path.join(specRoot, '01-inbox', `feature-${slug}.md`), lines.join('\n') + '\n');
}

function runCli(root, args) {
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    const r = spawnSync('node', [cli, ...args], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, encoding: 'utf8' });
    return { stdout: r.stdout || '', stderr: r.stderr || '', code: r.status ?? 1 };
}

function backlogIds(specRoot) {
    const ids = {};
    for (const f of fs.readdirSync(path.join(specRoot, '02-backlog'))) {
        const m = f.match(/^feature-(\d+)-(.+)\.md$/);
        if (m) ids[m[2]] = parseInt(m[1], 10);
    }
    return ids;
}

// ---------------------------------------------------------------------------
// Unit: readSetMembership (table-driven)
// ---------------------------------------------------------------------------

const READ_SET_CASES = [
    ['no frontmatter → null/false',   '# Feature\n\nbody',                               { set: null,        set_lead: false }],
    ['reads set + set_lead',          '---\ncomplexity: low\nset: my-set\nset_lead: true\n---\n\n# F', { set: 'my-set',    set_lead: true }],
    ['set_lead defaults to false',    '---\nset: other-set\n---\n\n# F',                 { set: 'other-set', set_lead: false }],
];
for (const [name, content, expected] of READ_SET_CASES) {
    test(`readSetMembership: ${name}`, () => assert.deepStrictEqual(readSetMembership(content), expected));
}

// ---------------------------------------------------------------------------
// Unit: topoSort (table-driven)
// ---------------------------------------------------------------------------

const TOPO_CASES = [
    ['single spec, no deps',
        [{ slug: 'alpha', set_lead: false, deps: [] }],
        { sorted: ['alpha'], cycleHasNodes: null }],
    ['linear chain A <- B <- C',
        [{ slug: 'c-feature', set_lead: false, deps: ['b-feature'] },
         { slug: 'a-feature', set_lead: false, deps: [] },
         { slug: 'b-feature', set_lead: false, deps: ['a-feature'] }],
        { sorted: ['a-feature', 'b-feature', 'c-feature'], cycleHasNodes: null }],
    ['set_lead ranks before alphabetical peer',
        [{ slug: 'zebra', set_lead: false, deps: [] },
         { slug: 'alpha', set_lead: true,  deps: [] }],
        { sorted: ['alpha', 'zebra'], cycleHasNodes: null }],
    ['alphabetical tie-breaker without set_lead',
        [{ slug: 'zebra', set_lead: false, deps: [] },
         { slug: 'apple', set_lead: false, deps: [] },
         { slug: 'mango', set_lead: false, deps: [] }],
        { sorted: ['apple', 'mango', 'zebra'], cycleHasNodes: null }],
    ['cycle → sorted=[] and cycle path names both nodes',
        [{ slug: 'aaa', set_lead: false, deps: ['bbb'] },
         { slug: 'bbb', set_lead: false, deps: ['aaa'] }],
        { sorted: [], cycleHasNodes: ['aaa', 'bbb'] }],
    ['cross-set external dep is ignored in ordering',
        [{ slug: 'c-feature', set_lead: false, deps: ['external-parent'] },
         { slug: 'a-feature', set_lead: false, deps: [] }],
        { sorted: ['a-feature', 'c-feature'], cycleHasNodes: null }],
];
for (const [name, specs, expected] of TOPO_CASES) {
    test(`topoSort: ${name}`, () => {
        const { sorted, cycle } = topoSort(specs);
        assert.deepStrictEqual(sorted, expected.sorted);
        if (expected.cycleHasNodes === null) {
            assert.strictEqual(cycle, null);
        } else {
            assert.ok(Array.isArray(cycle) && cycle.length > 0, 'cycle path should be non-empty');
            for (const node of expected.cycleHasNodes) {
                assert.ok(cycle.includes(node), `cycle should name ${node}`);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Unit: getAllKnownSets
// ---------------------------------------------------------------------------

test('getAllKnownSets: empty when no specs carry set:', () => withTempDir('aigon-sets-', (root) => {
    const specRoot = path.join(root, 'docs', 'specs', 'features');
    fs.mkdirSync(path.join(specRoot, '01-inbox'), { recursive: true });
    fs.writeFileSync(path.join(specRoot, '01-inbox', 'feature-no-set.md'), '---\ncomplexity: low\n---\n\n# F\n');
    assert.deepStrictEqual(getAllKnownSets(specRoot), []);
}));

test('getAllKnownSets: sorted distinct sets from inbox + backlog', () => withTempDir('aigon-sets-', (root) => {
    const specRoot = path.join(root, 'docs', 'specs', 'features');
    fs.mkdirSync(path.join(specRoot, '01-inbox'), { recursive: true });
    fs.mkdirSync(path.join(specRoot, '02-backlog'), { recursive: true });
    fs.writeFileSync(path.join(specRoot, '01-inbox', 'feature-a.md'), '---\nset: beta-set\n---\n\n# A\n');
    fs.writeFileSync(path.join(specRoot, '02-backlog', 'feature-01-b.md'), '---\nset: alpha-set\n---\n\n# B\n');
    assert.deepStrictEqual(getAllKnownSets(specRoot), ['alpha-set', 'beta-set']);
}));

// ---------------------------------------------------------------------------
// Integration: happy-path + cycle + --all-sets + --dry-run (one CLI run each)
// ---------------------------------------------------------------------------

test('feature-prioritise --set: three specs assigned IDs in toposort order', () => withTempDir('aigon-set-prio-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);
    writeInboxSpec(specRoot, 'foundation', { set: 'test-set', set_lead: true });
    writeInboxSpec(specRoot, 'middle',     { set: 'test-set', depends_on: 'foundation' });
    writeInboxSpec(specRoot, 'top',        { set: 'test-set', depends_on: 'middle' });

    const result = runCli(root, ['feature-prioritise', '--set', 'test-set', '--yes']);
    assert.strictEqual(result.code, 0, `${result.stdout}${result.stderr}`);

    const ids = backlogIds(specRoot);
    assert.ok(ids.foundation < ids.middle && ids.middle < ids.top,
        `IDs must follow dep order: foundation=${ids.foundation}, middle=${ids.middle}, top=${ids.top}`);
}));

test('feature-prioritise --set: cycle → non-zero exit + nothing moved', () => withTempDir('aigon-set-cycle-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);
    writeInboxSpec(specRoot, 'aaa', { set: 'cycle-set', depends_on: 'bbb' });
    writeInboxSpec(specRoot, 'bbb', { set: 'cycle-set', depends_on: 'aaa' });

    const result = runCli(root, ['feature-prioritise', '--set', 'cycle-set', '--yes']);
    assert.notStrictEqual(result.code, 0, 'must exit non-zero on cycle');
    assert.ok((result.stdout + result.stderr).includes('Circular'), 'must mention Circular');
    assert.strictEqual(fs.readdirSync(path.join(specRoot, '02-backlog')).length, 0,
        'no specs should move when a cycle is detected');
}));

test('feature-prioritise --all-sets: each set toposorted; --dry-run + unknown set + cross-set parent all refuse', () => withTempDir('aigon-multi-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);

    // Two distinct sets: alpha (chain) + beta (standalone)
    writeInboxSpec(specRoot, 'alpha-base',  { set: 'alpha', set_lead: true });
    writeInboxSpec(specRoot, 'alpha-child', { set: 'alpha', depends_on: 'alpha-base' });
    writeInboxSpec(specRoot, 'beta-only',   { set: 'beta' });

    // --dry-run: must not move anything
    const dry = runCli(root, ['feature-prioritise', '--set', 'alpha', '--dry-run']);
    assert.strictEqual(dry.code, 0, `dry-run failed: ${dry.stdout}${dry.stderr}`);
    assert.ok((dry.stdout + dry.stderr).includes('dry-run'), 'must say dry-run');
    assert.strictEqual(fs.readdirSync(path.join(specRoot, '02-backlog')).length, 0, 'dry-run must move nothing');

    // Unknown set: exit non-zero
    const unknown = runCli(root, ['feature-prioritise', '--set', 'ghost-set', '--yes']);
    assert.notStrictEqual(unknown.code, 0, 'unknown set must exit non-zero');

    // Real run: all 3 sets prioritise, IDs in dep order for alpha
    const result = runCli(root, ['feature-prioritise', '--all-sets', '--yes']);
    assert.strictEqual(result.code, 0, `${result.stdout}${result.stderr}`);
    const ids = backlogIds(specRoot);
    assert.ok(ids['alpha-base'] < ids['alpha-child'],
        `alpha-base=${ids['alpha-base']} must come before alpha-child=${ids['alpha-child']}`);
    assert.ok(ids['beta-only'] !== undefined, 'beta-only must also be prioritised');
}));

test('feature-prioritise --set: refuses when cross-set parent is still in inbox', () => withTempDir('aigon-cross-set-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);
    writeInboxSpec(specRoot, 'parent-other');                                          // unset, in inbox
    writeInboxSpec(specRoot, 'child', { set: 'my-set', depends_on: 'parent-other' });  // in set, depends on inbox parent

    const result = runCli(root, ['feature-prioritise', '--set', 'my-set', '--yes']);
    assert.notStrictEqual(result.code, 0, 'must refuse cross-set unmet dep');
    assert.ok((result.stdout + result.stderr).match(/parent-other|Cannot prioritise/),
        'must name the blocking parent or say Cannot prioritise');
    assert.strictEqual(fs.readdirSync(path.join(specRoot, '02-backlog')).length, 0, 'nothing should move');
}));

test('feature-prioritise --set without slug → usage error', () => withTempDir('aigon-missing-slug-', (root) => {
    initRepo(root);
    mkSpecRoot(root);
    const result = runCli(root, ['feature-prioritise', '--set', '--dry-run']);
    assert.notStrictEqual(result.code, 0);
    assert.ok((result.stdout + result.stderr).match(/Usage|slug/), 'must mention Usage or slug');
}));

test('feature-prioritise <slug>: single-slug regression still works', () => withTempDir('aigon-single-slug-', (root) => {
    initRepo(root);
    const specRoot = mkSpecRoot(root);
    writeInboxSpec(specRoot, 'standalone');

    const result = runCli(root, ['feature-prioritise', 'standalone']);
    assert.strictEqual(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.ok(fs.readdirSync(path.join(specRoot, '02-backlog')).some(f => f.includes('standalone')));
}));

report();
