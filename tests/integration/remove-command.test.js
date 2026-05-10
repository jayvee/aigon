#!/usr/bin/env node
// @smoke
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
const installManifestLib = require('../../lib/install-manifest');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runAigon(repo, args, expectFail = false) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        stdio: 'pipe',
    });
    const combined = (result.stdout || '').toString() + (result.stderr || '').toString();
    if (!expectFail && result.status !== 0) {
        throw new Error(`aigon ${args.join(' ')} failed (status ${result.status}): ${combined}`);
    }
    return { status: result.status, output: combined };
}

function gitInit(repo) {
    spawnSync('git', ['init', '-q'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-qb', 'main'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
}

function installAgent(repo) {
    const result = spawnSync(process.execPath, [CLI, 'install-agent', 'cc'], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        stdio: 'pipe',
    });
    return (result.stdout || '').toString() + (result.stderr || '').toString();
}

// F513: remove preserves spec folder
testAsync('remove: spec folders are preserved after remove', () => withTempDirAsync('aigon-f513-rm-spec-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);
    installAgent(repo);

    // create a spec file that must survive
    const inboxDir = path.join(repo, 'docs', 'specs', 'features', '01-inbox');
    fs.writeFileSync(path.join(inboxDir, 'feature-my-spec.md'), '# My spec');

    runAigon(repo, ['remove', '--force']);

    assert.ok(fs.existsSync(path.join(inboxDir, 'feature-my-spec.md')), 'spec file must survive remove');
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '01-inbox')), 'spec folder must survive remove');
}));

// F513: remove --purge also wipes .aigon/
testAsync('remove --purge: removes .aigon/ runtime state', () => withTempDirAsync('aigon-f513-purge-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);
    installAgent(repo);

    assert.ok(fs.existsSync(path.join(repo, '.aigon')), 'pre-condition: .aigon/ exists');
    runAigon(repo, ['remove', '--purge', '--force']);
    assert.ok(!fs.existsSync(path.join(repo, '.aigon')), '.aigon/ must be gone after --purge');
}));

// F513: remove --dry-run makes no changes
testAsync('remove --dry-run: makes no changes', () => withTempDirAsync('aigon-f513-dryrun-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);
    installAgent(repo);
    const manifest = installManifestLib.readManifest(repo);
    assert.ok(manifest && manifest.files.length > 0, 'pre-condition: manifest has files');

    runAigon(repo, ['remove', '--dry-run']);

    // All manifest files must still exist
    for (const entry of manifest.files) {
        assert.ok(fs.existsSync(path.join(repo, entry.path)), `${entry.path} must still exist after --dry-run`);
    }
    assert.ok(installManifestLib.readManifest(repo), 'manifest must still exist after --dry-run');
}));

// F513: remove refuses to run in worktree
testAsync('remove: refuses to run in worktree', () => withTempDirAsync('aigon-f513-wt-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);

    // Simulate a worktree marker
    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'worktree.json'), JSON.stringify({ mainRepo: '/tmp/main-repo' }));

    const { status, output } = runAigon(repo, ['remove', '--force'], true);
    assert.notStrictEqual(status, 0, 'remove must exit non-zero in worktree');
    assert.ok(output.includes('worktree'), `must mention worktree: ${output}`);
}));

// F513: full cycle apply → remove --purge → apply is idempotent
testAsync('remove: apply → remove --purge → apply cycle works', () => withTempDirAsync('aigon-f513-cycle-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);
    installAgent(repo);
    // --purge removes .aigon/ so the next apply sees a truly fresh repo
    runAigon(repo, ['remove', '--purge', '--force']);

    assert.ok(!fs.existsSync(path.join(repo, '.aigon')), 'pre-condition: .aigon/ gone after purge');

    // Second apply should bootstrap as first-time
    const { output } = runAigon(repo, ['apply']);
    assert.ok(output.includes('First-time setup'), `banner must appear after remove+re-apply: ${output}`);
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '01-inbox')), 'spec folders must be recreated');
}));

report();
