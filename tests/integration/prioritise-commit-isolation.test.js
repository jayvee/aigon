#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function writeInboxFeatureSpec(root, slug) {
    const dir = path.join(root, 'docs', 'specs', 'features', '01-inbox');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
        '---',
        'complexity: low',
        '---',
        '',
        `# Feature: ${slug}`,
        '',
    ];
    fs.writeFileSync(path.join(dir, `feature-${slug}.md`), lines.join('\n'));
}

function writeInboxResearchSpec(root, slug) {
    const dir = path.join(root, 'docs', 'specs', 'research-topics', '01-inbox');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
        '---',
        'complexity: low',
        '---',
        '',
        `# Research: ${slug}`,
        '',
    ];
    fs.writeFileSync(path.join(dir, `research-${slug}.md`), lines.join('\n'));
}

function featureSpecRoot(root) {
    return path.join(root, 'docs', 'specs', 'features');
}

function gitNamesInHead(root) {
    const out = execFileSync(
        'git',
        ['show', '--pretty=format:', '--name-only', 'HEAD'],
        { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV } },
    );
    return out.split('\n').map(x => x.trim()).filter(Boolean);
}

// REGRESSION: F452 directory-level git add on prioritise bundled unrelated inbox files.
test('prioritise commit excludes unrelated untracked inbox specs', () => withTempDir('aigon-priso-inbox-', (root) => {
    initRepo(root);
    const specRoot = featureSpecRoot(root);
    FOLDERS.forEach(f => fs.mkdirSync(path.join(specRoot, f), { recursive: true }));
    writeInboxFeatureSpec(root, 'main-spec');
    const strangerAbs = path.join(specRoot, '01-inbox', 'feature-stranger-untracked.md');
    fs.writeFileSync(strangerAbs, '# stray\n');

    execFileSync('git', ['add', path.join(specRoot, '01-inbox', 'feature-main-spec.md')], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        stdio: 'pipe',
    });
    execFileSync('git', ['commit', '-m', 'chore: add main spec'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });

    const r = runCli(root, ['feature-prioritise', 'main-spec']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);

    const names = gitNamesInHead(root);
    assert.ok(names.some(n => n.includes('feature-01-main-spec')), names.join(','));
    assert.ok(!names.some(n => n.includes('stranger-untracked')), names.join(','));
    assert.ok(fs.existsSync(strangerAbs), 'stranger file should remain');
    const st = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV } });
    assert.ok(/^\?\?\s+docs\/specs\/features\/01-inbox\/feature-stranger-untracked\.md$/m.test(st),
        `expected ?? stranger, got:\n${st}`);
}));

// REGRESSION: F452 broad-stage picked up unrelated staged deletions under spec tree.
test('prioritise commit excludes pre-staged deletion of unrelated spec', () => withTempDir('aigon-priso-rm-', (root) => {
    initRepo(root);
    const specRoot = featureSpecRoot(root);
    FOLDERS.forEach(f => fs.mkdirSync(path.join(specRoot, f), { recursive: true }));

    fs.writeFileSync(path.join(specRoot, '01-inbox', 'feature-main-spec.md'), '---\ncomplexity: low\n---\n\n# Main\n');
    fs.writeFileSync(path.join(specRoot, '01-inbox', 'feature-extra-spec.md'), '---\ncomplexity: low\n---\n\n# Extra\n');

    execFileSync('git', ['add', path.join(specRoot, '01-inbox')], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        stdio: 'pipe',
    });
    execFileSync('git', ['commit', '-m', 'chore: add specs'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });

    execFileSync('git', ['rm', '--cached', path.join(specRoot, '01-inbox', 'feature-extra-spec.md')], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        stdio: 'pipe',
    });

    const r = runCli(root, ['feature-prioritise', 'main-spec']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);

    const names = gitNamesInHead(root);
    assert.ok(!names.some(n => n.includes('extra-spec')), names.join(','));
    const staged = execFileSync('git', ['diff', '--cached', '--name-status'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ...GIT_SAFE_ENV },
    });
    assert.ok(staged.includes('feature-extra-spec.md'), staged);
}));

// REGRESSION: F452 shared entityPrioritise must keep research commits precise.
test('research-prioritise commit excludes unrelated inbox topics', () => withTempDir('aigon-priso-rsch-', (root) => {
    initRepo(root);
    const rt = path.join(root, 'docs', 'specs', 'research-topics');
    FOLDERS.forEach(f => fs.mkdirSync(path.join(rt, f), { recursive: true }));
    writeInboxResearchSpec(root, 'isolate-main');
    const strangerAbs = path.join(rt, '01-inbox', 'research-stranger-untracked.md');
    fs.writeFileSync(strangerAbs, '# stray\n');

    execFileSync('git', ['add', path.join(rt, '01-inbox', 'research-isolate-main.md')], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        stdio: 'pipe',
    });
    execFileSync('git', ['commit', '-m', 'chore: add research'], { cwd: root, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });

    const r = runCli(root, ['research-prioritise', 'isolate-main']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);

    const names = gitNamesInHead(root);
    assert.ok(names.some(n => /research-\d+-isolate-main\.md/.test(n)), names.join(','));
    assert.ok(!names.some(n => n.includes('stranger-untracked')), names.join(','));
    assert.ok(fs.existsSync(strangerAbs));
}));

// REGRESSION: F452 broad-stage on feature-now sucked in sibling inbox churn.
test('feature-now commit excludes unrelated inbox file', () => withTempDir('aigon-frnow-', (root) => {
    initRepo(root);
    const specRoot = featureSpecRoot(root);
    FOLDERS.forEach(f => fs.mkdirSync(path.join(specRoot, f), { recursive: true }));
    fs.writeFileSync(path.join(specRoot, '01-inbox', 'stranger-holder.md'), '# keep inbox dirty\n');

    const r = runCli(root, ['feature-now', 'Isolation Now']);
    assert.strictEqual(r.code, 0, r.stdout + r.stderr);

    const names = gitNamesInHead(root);
    assert.ok(names.some(n => /03-in-progress\/feature-\d+-isolation-now\.md/.test(n)), names.join(','));
    assert.ok(!names.some(n => n.includes('stranger-holder')), names.join(','));
    assert.ok(fs.existsSync(path.join(specRoot, '01-inbox', 'stranger-holder.md')));
}));

report();
