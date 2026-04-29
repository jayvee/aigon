#!/usr/bin/env node
'use strict';

// Regression coverage for the lifecycle-commit source-deletion bug.
//
// Symptom (pre-fix): the prioritise / start / unprioritise commits staged only the
// destination spec path. The `move_spec` effect renamed the file via fs.rename
// on disk, but the git index never recorded the source-folder deletion. HEAD
// ended up with the same spec tracked in multiple lifecycle folders — F456,
// F458, F459, F460 each had three duplicate copies before this fix.
//
// Each test below asserts both halves of the rename are committed: the source
// path appears as `D` (delete) and the destination as `A` (add) in the
// resulting commit's --name-status output, and `git ls-files` no longer
// returns the source path.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

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
    const r = spawnSync('node', [cli, ...args], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
    });
    return { stdout: r.stdout || '', stderr: r.stderr || '', code: r.status ?? 1 };
}

function nameStatus(root, ref = 'HEAD') {
    return execFileSync(
        'git',
        ['show', '--pretty=format:', '--name-status', ref],
        { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV } },
    );
}

function lsFiles(root, prefix) {
    return execFileSync(
        'git',
        ['ls-files', '--', prefix],
        { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV } },
    );
}

function writeFeatureInboxSpec(root, slug) {
    const dir = path.join(root, 'docs', 'specs', 'features', '01-inbox');
    fs.mkdirSync(dir, { recursive: true });
    const body = ['---', 'complexity: low', '---', '', `# Feature: ${slug}`, ''].join('\n');
    fs.writeFileSync(path.join(dir, `feature-${slug}.md`), body);
}

function writeResearchInboxSpec(root, slug) {
    const dir = path.join(root, 'docs', 'specs', 'research-topics', '01-inbox');
    fs.mkdirSync(dir, { recursive: true });
    const body = ['---', 'complexity: low', '---', '', `# Research: ${slug}`, ''].join('\n');
    fs.writeFileSync(path.join(dir, `research-${slug}.md`), body);
}

function commitInbox(root, kind /* 'features' | 'research-topics' */) {
    execFileSync('git', ['add', `docs/specs/${kind}/01-inbox/`], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `chore: add ${kind} inbox spec`], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
}

test('feature-prioritise stages source-deletion (no inbox lingerer)', () => withTempDir('aigon-prio-del-', (root) => {
    initRepo(root);
    FOLDERS.forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', 'features', f), { recursive: true }));
    writeFeatureInboxSpec(root, 'src-del-prio');
    commitInbox(root, 'features');

    const r = runCli(root, ['feature-prioritise', 'src-del-prio']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);

    const ns = nameStatus(root);
    const isRename = /R\d+\tdocs\/specs\/features\/01-inbox\/feature-src-del-prio\.md\tdocs\/specs\/features\/02-backlog\/feature-01-src-del-prio\.md/.test(ns);
    const isDeleteAdd = /D\tdocs\/specs\/features\/01-inbox\/feature-src-del-prio\.md/.test(ns)
        && /A\tdocs\/specs\/features\/02-backlog\/feature-01-src-del-prio\.md/.test(ns);
    assert.ok(isRename || isDeleteAdd, `expected rename or D+A for 01-inbox → 02-backlog, got:\n${ns}`);

    const tracked = lsFiles(root, 'docs/specs/features/01-inbox/');
    assert.ok(!/feature-src-del-prio\.md/.test(tracked), `01-inbox should not retain spec, got:\n${tracked}`);
}));

test('feature-start stages backlog-deletion (no backlog lingerer)', () => withTempDir('aigon-start-del-', (root) => {
    initRepo(root);
    FOLDERS.forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', 'features', f), { recursive: true }));
    writeFeatureInboxSpec(root, 'src-del-start');
    commitInbox(root, 'features');

    const rp = runCli(root, ['feature-prioritise', 'src-del-start']);
    assert.strictEqual(rp.code, 0, rp.stdout + rp.stderr);

    const rs = runCli(root, ['feature-start', '01']);
    assert.strictEqual(rs.code, 0, rs.stdout + rs.stderr);

    // Git can record the move as a rename (R100) or as separate D/A entries —
    // both prove the source-deletion was staged. The pre-fix bug showed only A.
    const ns = nameStatus(root);
    const isRename = /R\d+\tdocs\/specs\/features\/02-backlog\/feature-01-src-del-start\.md\tdocs\/specs\/features\/03-in-progress\/feature-01-src-del-start\.md/.test(ns);
    const isDeleteAdd = /D\tdocs\/specs\/features\/02-backlog\/feature-01-src-del-start\.md/.test(ns)
        && /A\tdocs\/specs\/features\/03-in-progress\/feature-01-src-del-start\.md/.test(ns);
    assert.ok(isRename || isDeleteAdd, `expected rename or D+A for 02-backlog → 03-in-progress, got:\n${ns}`);

    const tracked = lsFiles(root, 'docs/specs/features/02-backlog/');
    assert.ok(!/feature-01-src-del-start\.md/.test(tracked), `02-backlog should not retain spec, got:\n${tracked}`);
}));

test('feature-unprioritise stages backlog-deletion (no backlog lingerer)', () => withTempDir('aigon-unprio-del-', (root) => {
    initRepo(root);
    FOLDERS.forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', 'features', f), { recursive: true }));
    writeFeatureInboxSpec(root, 'src-del-unprio');
    commitInbox(root, 'features');

    let r = runCli(root, ['feature-prioritise', 'src-del-unprio']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);
    r = runCli(root, ['feature-unprioritise', '01']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);

    const ns = nameStatus(root);
    const isRename = /R\d+\tdocs\/specs\/features\/02-backlog\/feature-01-src-del-unprio\.md\tdocs\/specs\/features\/01-inbox\/feature-src-del-unprio\.md/.test(ns);
    const isDeleteAdd = /D\tdocs\/specs\/features\/02-backlog\/feature-01-src-del-unprio\.md/.test(ns)
        && /A\tdocs\/specs\/features\/01-inbox\/feature-src-del-unprio\.md/.test(ns);
    assert.ok(isRename || isDeleteAdd, `expected rename or D+A for 02-backlog → 01-inbox, got:\n${ns}`);

    const tracked = lsFiles(root, 'docs/specs/features/02-backlog/');
    assert.ok(!/feature-01-src-del-unprio\.md/.test(tracked), `02-backlog should not retain spec, got:\n${tracked}`);
}));

test('research-prioritise stages source-deletion (no inbox lingerer)', () => withTempDir('aigon-rprio-del-', (root) => {
    initRepo(root);
    ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused', 'logs']
        .forEach(f => fs.mkdirSync(path.join(root, 'docs', 'specs', 'research-topics', f), { recursive: true }));
    writeResearchInboxSpec(root, 'src-del-rprio');
    commitInbox(root, 'research-topics');

    const r = runCli(root, ['research-prioritise', 'src-del-rprio']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);

    const ns = nameStatus(root);
    const isRename = /R\d+\tdocs\/specs\/research-topics\/01-inbox\/research-src-del-rprio\.md\tdocs\/specs\/research-topics\/02-backlog\/research-01-src-del-rprio\.md/.test(ns);
    const isDeleteAdd = /D\tdocs\/specs\/research-topics\/01-inbox\/research-src-del-rprio\.md/.test(ns)
        && /A\tdocs\/specs\/research-topics\/02-backlog\/research-01-src-del-rprio\.md/.test(ns);
    assert.ok(isRename || isDeleteAdd, `expected rename or D+A for research 01-inbox → 02-backlog, got:\n${ns}`);

    const tracked = lsFiles(root, 'docs/specs/research-topics/01-inbox/');
    assert.ok(!/research-src-del-rprio\.md/.test(tracked), `research 01-inbox should not retain spec, got:\n${tracked}`);
}));

report();
