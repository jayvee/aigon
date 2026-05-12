#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const { parseDependsOn, checkDepsPrioritised } = require('../../lib/feature-deps');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function mkFeaturePaths(root) {
    FOLDERS.forEach(f => fs.mkdirSync(path.join(root, f), { recursive: true }));
    return { root, folders: FOLDERS };
}

function initRepo(root) {
    execFileSync('git', ['init'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    fs.writeFileSync(path.join(root, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: init'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
}

function runCli(root, args) {
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', [cli, ...args], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
    });
    return {
        stdout: r.stdout || '',
        stderr: r.stderr || '',
        code: r.status ?? 1,
    };
}

function writeInboxSpec(root, slug, dependsOnBody = null) {
    const dir = path.join(root, 'docs', 'specs', 'features', '01-inbox');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
        '---',
        'complexity: low',
        '---',
        '',
        `# Feature: ${slug}`,
        '',
        '## Dependencies',
        '',
    ];
    if (dependsOnBody) lines.push(`depends_on: ${dependsOnBody}`);
    else lines.push('depends_on: none');
    lines.push('');
    fs.writeFileSync(path.join(dir, `feature-${slug}.md`), lines.join('\n'));
}

// --- parseDependsOn (table-driven) ---
const PARSE_CASES = [
    ['missing depends_on',           '# Feature\n\nsome body',          []],
    ['depends_on: none',             'depends_on: none',                []],
    ['empty depends_on',             'depends_on: ',                    []],
    ['single slug',                  'depends_on: parent-slug',         ['parent-slug']],
    ['comma-separated slugs',        'depends_on: foo, bar, baz',       ['foo', 'bar', 'baz']],
    ['numeric ID',                   'depends_on: 443',                 ['443']],
];
for (const [name, body, expected] of PARSE_CASES) {
    test(`parseDependsOn: ${name}`, () => assert.deepStrictEqual(parseDependsOn(body), expected));
}

// --- checkDepsPrioritised: parent folder determines violation ---
//   01-inbox / missing  → violation
//   02-backlog, 03-in-progress, 05-done, 06-paused → no violation (already past inbox)
const DEP_CASES = [
    ['01-inbox',       'feature-parent.md',     { violations: 1, status: '01-inbox' }],
    [null,             null,                    { violations: 1, status: 'missing' }],
    ['02-backlog',     'feature-01-parent.md',  { violations: 0 }],
    ['03-in-progress', 'feature-01-parent.md',  { violations: 0 }],
    ['05-done',        'feature-01-parent.md',  { violations: 0 }],
    ['06-paused',      'feature-01-parent.md',  { violations: 0 }],
];
for (const [folder, file, expected] of DEP_CASES) {
    test(`checkDepsPrioritised: parent in ${folder || 'missing'} → ${expected.violations ? 'violation' : 'ok'}`, () =>
        withTempDir('aigon-dep-val-', (root) => {
            const paths = mkFeaturePaths(root);
            if (folder) fs.writeFileSync(path.join(root, folder, file), '# parent\n');
            const target = folder ? 'parent' : 'ghost-feature';
            const violations = checkDepsPrioritised([target], paths);
            assert.strictEqual(violations.length, expected.violations);
            if (expected.status) assert.strictEqual(violations[0].status, expected.status);
        }));
}

// ---------------------------------------------------------------------------
// Integration test: prioritise child before parent fails, then succeeds
// ---------------------------------------------------------------------------

test('feature-prioritise refuses when parent is still in inbox', () => withTempDir('aigon-dep-validate-', (root) => {
    initRepo(root);

    const specRoot = path.join(root, 'docs', 'specs', 'features');
    FOLDERS.forEach(f => fs.mkdirSync(path.join(specRoot, f), { recursive: true }));
    writeInboxSpec(root, 'parent-feature');
    writeInboxSpec(root, 'child-feature', 'parent-feature');

    // Attempt to prioritise child (parent still in inbox) — must fail non-zero
    const result = runCli(root, ['feature-prioritise', 'child-feature']);
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero');
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('Cannot prioritise'), `Error message missing in output: ${combined}`);
    assert.ok(combined.includes('parent-feature'), `Parent slug missing in output: ${combined}`);

    // Child spec must still be in inbox
    assert.ok(
        fs.existsSync(path.join(specRoot, '01-inbox', 'feature-child-feature.md')),
        'child-feature.md must remain in 01-inbox after failed prioritise',
    );
    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.ok(
        !backlog.some(f => f.includes('child-feature')),
        'child-feature must not appear in 02-backlog',
    );
}));

test('feature-prioritise succeeds after parent is prioritised', () => withTempDir('aigon-dep-validate-', (root) => {
    initRepo(root);

    const specRoot = path.join(root, 'docs', 'specs', 'features');
    writeInboxSpec(root, 'parent-feature');
    writeInboxSpec(root, 'child-feature', 'parent-feature');

    // Prioritise parent first
    const parentResult = runCli(root, ['feature-prioritise', 'parent-feature']);
    assert.strictEqual(parentResult.code, 0, `parent-prioritise failed: ${parentResult.stdout}${parentResult.stderr}`);

    // Now prioritise child — must succeed
    const childResult = runCli(root, ['feature-prioritise', 'child-feature']);
    assert.strictEqual(childResult.code, 0, `child-prioritise failed: ${childResult.stdout}${childResult.stderr}`);

    // Child must be in backlog
    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.ok(backlog.some(f => f.includes('child-feature')), 'child-feature must be in 02-backlog after success');
}));

test('feature-prioritise --skip-dep-check succeeds despite unprioritised parent', () => withTempDir('aigon-dep-validate-skip-', (root) => {
    initRepo(root);

    const specRoot = path.join(root, 'docs', 'specs', 'features');
    writeInboxSpec(root, 'parent-feature');
    writeInboxSpec(root, 'child-feature', 'parent-feature');

    // --skip-dep-check must succeed even though parent is still in inbox
    const result = runCli(root, ['feature-prioritise', 'child-feature', '--skip-dep-check']);
    assert.strictEqual(result.code, 0, `Expected success with --skip-dep-check: ${result.stdout}${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('skip-dep-check') || combined.includes('bypass'), `Warning missing in output: ${combined}`);

    // Child must be in backlog despite parent being in inbox
    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.ok(backlog.some(f => f.includes('child-feature')), 'child-feature must be in 02-backlog');
}));

test('feature-prioritise allows no-dep features unchanged', () => withTempDir('aigon-dep-validate-nodep-', (root) => {
    initRepo(root);

    const specRoot = path.join(root, 'docs', 'specs', 'features');
    writeInboxSpec(root, 'standalone-feature'); // depends_on: none

    const result = runCli(root, ['feature-prioritise', 'standalone-feature']);
    assert.strictEqual(result.code, 0, `Expected success for feature with no deps: ${result.stdout}${result.stderr}`);
    const backlog = fs.readdirSync(path.join(specRoot, '02-backlog'));
    assert.ok(backlog.some(f => f.includes('standalone-feature')), 'standalone-feature must be in 02-backlog');
}));

report();
