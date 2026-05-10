#!/usr/bin/env node
// @smoke
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');

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

// F513: apply on fresh git repo bootstraps the spec structure
testAsync('apply-bootstrap: fresh git repo gets spec folders and applied-digest', () => withTempDirAsync('aigon-f513-fresh-', async (repo) => {
    gitInit(repo);
    assert.ok(!fs.existsSync(path.join(repo, '.aigon')), 'pre-condition: no .aigon/');

    const { output } = runAigon(repo, ['apply']);
    assert.ok(output.includes('First-time setup'), `banner must appear: ${output}`);

    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '01-inbox')), 'features/01-inbox must be created');
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'research-topics', '01-inbox')), 'research-topics/01-inbox must be created');
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'applied-digest')), 'applied-digest must be written');
}));

// F513: second apply does NOT re-print the banner
testAsync('apply-bootstrap: second run is silent (no banner)', () => withTempDirAsync('aigon-f513-noop-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);

    const { output } = runAigon(repo, ['apply']);
    assert.ok(!output.includes('First-time setup'), `banner must NOT appear on second run: ${output}`);
}));

// F513: non-git directory exits non-zero and creates nothing
testAsync('apply-bootstrap: non-git dir exits non-zero and creates nothing', () => withTempDirAsync('aigon-f513-nogit-', async (repo) => {
    const { status, output } = runAigon(repo, ['apply'], true);
    assert.notStrictEqual(status, 0, 'must exit non-zero in non-git dir');
    assert.ok(output.includes('Not a Git repository'), `must say "Not a Git repository": ${output}`);
    assert.ok(!fs.existsSync(path.join(repo, '.aigon')), '.aigon must not be created');
}));

// F513: aigon init still works but prints deprecation warning
testAsync('init-deprecation: init prints deprecation warning and forwards', () => withTempDirAsync('aigon-f513-init-dep-', async (repo) => {
    gitInit(repo);
    const { output } = runAigon(repo, ['init']);
    assert.ok(output.toLowerCase().includes('deprecated') || output.includes('aigon apply'), `must mention deprecation: ${output}`);
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '01-inbox')), 'init must still bootstrap the repo');
}));

// F513: aigon uninstall produces redirect error
testAsync('uninstall-alias: aigon uninstall exits non-zero with redirect hint', () => withTempDirAsync('aigon-f513-uninst-', async (repo) => {
    gitInit(repo);
    const { status, output } = runAigon(repo, ['uninstall'], true);
    assert.notStrictEqual(status, 0, 'uninstall must exit non-zero');
    assert.ok(output.includes('aigon remove'), `must say "aigon remove": ${output}`);
}));

report();
