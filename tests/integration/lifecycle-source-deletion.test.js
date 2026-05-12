#!/usr/bin/env node
'use strict';

// Regression coverage for the lifecycle-commit source-deletion bug.
//
// Symptom (pre-fix): prioritise / start / unprioritise commits staged only the destination
// spec path. `move_spec` renamed via fs.rename, but git never recorded the source-folder
// deletion. HEAD ended up with the same spec tracked in multiple lifecycle folders.
//
// Each scenario asserts both halves of the rename are committed (rename or D+A in
// --name-status) and the source path is no longer tracked.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');

const FEATURE_FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
const RESEARCH_FOLDERS = [...FEATURE_FOLDERS, 'logs'];

function git(root, args) {
    execFileSync('git', args, { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
}

function initRepo(root) {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@aigon.test']);
    git(root, ['config', 'user.name', 'Aigon Test']);
    fs.writeFileSync(path.join(root, '.gitkeep'), '');
    git(root, ['add', '.gitkeep']);
    git(root, ['commit', '-m', 'chore: init']);
}

function runCli(root, args) {
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    const r = spawnSync('node', [cli, ...args], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, encoding: 'utf8' });
    return { stdout: r.stdout || '', stderr: r.stderr || '', code: r.status ?? 1 };
}

function nameStatus(root) {
    return execFileSync('git', ['show', '--pretty=format:', '--name-status', 'HEAD'],
        { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV } });
}

function lsFiles(root, prefix) {
    return execFileSync('git', ['ls-files', '--', prefix],
        { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV } });
}

function seedSpec(root, kind /* 'features' | 'research-topics' */, slug) {
    const folders = kind === 'features' ? FEATURE_FOLDERS : RESEARCH_FOLDERS;
    folders.forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', kind, f), { recursive: true }));
    const prefix = kind === 'features' ? 'feature' : 'research';
    const body = ['---', 'complexity: low', '---', '', `# ${prefix === 'feature' ? 'Feature' : 'Research'}: ${slug}`, ''].join('\n');
    fs.writeFileSync(path.join(root, 'docs', 'specs', kind, '01-inbox', `${prefix}-${slug}.md`), body);
    git(root, ['add', `docs/specs/${kind}/01-inbox/`]);
    git(root, ['commit', '-m', `chore: add ${kind} inbox spec`]);
}

function assertSourceDeleted({ ns, srcPath, dstPath, tracked, srcFile }) {
    const escSrc = srcPath.replace(/\//g, '\\/');
    const escDst = dstPath.replace(/\//g, '\\/');
    const isRename = new RegExp(`R\\d+\\t${escSrc}\\t${escDst}`).test(ns);
    const isDeleteAdd = new RegExp(`D\\t${escSrc}`).test(ns) && new RegExp(`A\\t${escDst}`).test(ns);
    assert.ok(isRename || isDeleteAdd, `expected rename or D+A for ${srcPath} → ${dstPath}, got:\n${ns}`);
    assert.ok(!new RegExp(srcFile.replace(/\./g, '\\.')).test(tracked),
        `${path.dirname(srcPath)} should not retain spec, got:\n${tracked}`);
}

const CASES = [
    {
        label: 'feature-prioritise stages source-deletion (no inbox lingerer)',
        tmp: 'aigon-prio-del-',
        kind: 'features', slug: 'src-del-prio',
        steps: (root) => [runCli(root, ['feature-prioritise', 'src-del-prio'])],
        srcPath: 'docs/specs/features/01-inbox/feature-src-del-prio.md',
        dstPath: 'docs/specs/features/02-backlog/feature-01-src-del-prio.md',
        trackedPrefix: 'docs/specs/features/01-inbox/',
        srcFile: 'feature-src-del-prio.md',
    },
    {
        label: 'feature-start stages backlog-deletion (no backlog lingerer)',
        tmp: 'aigon-start-del-',
        kind: 'features', slug: 'src-del-start',
        steps: (root) => [
            runCli(root, ['feature-prioritise', 'src-del-start']),
            runCli(root, ['feature-start', '01']),
        ],
        srcPath: 'docs/specs/features/02-backlog/feature-01-src-del-start.md',
        dstPath: 'docs/specs/features/03-in-progress/feature-01-src-del-start.md',
        trackedPrefix: 'docs/specs/features/02-backlog/',
        srcFile: 'feature-01-src-del-start.md',
    },
    {
        label: 'feature-unprioritise stages backlog-deletion (no backlog lingerer)',
        tmp: 'aigon-unprio-del-',
        kind: 'features', slug: 'src-del-unprio',
        steps: (root) => [
            runCli(root, ['feature-prioritise', 'src-del-unprio']),
            runCli(root, ['feature-unprioritise', '01']),
        ],
        srcPath: 'docs/specs/features/02-backlog/feature-01-src-del-unprio.md',
        dstPath: 'docs/specs/features/01-inbox/feature-src-del-unprio.md',
        trackedPrefix: 'docs/specs/features/02-backlog/',
        srcFile: 'feature-01-src-del-unprio.md',
    },
    {
        label: 'research-prioritise stages source-deletion (no inbox lingerer)',
        tmp: 'aigon-rprio-del-',
        kind: 'research-topics', slug: 'src-del-rprio',
        steps: (root) => [runCli(root, ['research-prioritise', 'src-del-rprio'])],
        srcPath: 'docs/specs/research-topics/01-inbox/research-src-del-rprio.md',
        dstPath: 'docs/specs/research-topics/02-backlog/research-01-src-del-rprio.md',
        trackedPrefix: 'docs/specs/research-topics/01-inbox/',
        srcFile: 'research-src-del-rprio.md',
    },
];

for (const c of CASES) {
    test(c.label, () => withTempDir(c.tmp, (root) => {
        initRepo(root);
        seedSpec(root, c.kind, c.slug);
        for (const r of c.steps(root)) assert.strictEqual(r.code, 0, r.stdout + r.stderr);
        assertSourceDeleted({
            ns: nameStatus(root),
            srcPath: c.srcPath,
            dstPath: c.dstPath,
            tracked: lsFiles(root, c.trackedPrefix),
            srcFile: c.srcFile,
        });
    }));
}

report();
