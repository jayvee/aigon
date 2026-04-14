#!/usr/bin/env node
'use strict';
// REGRESSION feature 255 follow-up: seed-reset must be able to clean remote
// feature/research branches even when the local repo has already been removed,
// and must re-strip stale seed config keys deterministically.
const a = require('assert');
const fs = require('fs');
const path = require('path');
const { withTempDir, test, report } = require('../_helpers');
const {
    normalizeGitHubRepoSlug,
    collectSeedResetRemoteUrls,
    parseSeedResetRemoteHeads,
    cleanupSeedResetRemoteBranches,
    closeSeedResetOpenPullRequests,
    stripSeedResetStaleConfigKeys,
} = require('../../lib/commands/setup')._test;

test('normalizeGitHubRepoSlug handles ssh and https remotes', () => {
    a.strictEqual(normalizeGitHubRepoSlug('https://github.com/jayvee/brewboard.git'), 'jayvee/brewboard');
    a.strictEqual(normalizeGitHubRepoSlug('git@github.com:jayvee/brewboard.git'), 'jayvee/brewboard');
    a.strictEqual(normalizeGitHubRepoSlug('https://gitlab.com/jayvee/brewboard.git'), null);
});

test('collectSeedResetRemoteUrls unions current origin, working repo, and seed', () => {
    const calls = [];
    const urls = collectSeedResetRemoteUrls({
        repoName: 'brewboard', seedUrl: 'https://github.com/jayvee/brewboard-seed.git', repoPath: '/tmp/brewboard', repoExists: true,
        workingRepoRegistry: { brewboard: 'https://github.com/jayvee/brewboard.git' },
        execFn: (cmd) => { calls.push(cmd); return 'git@github.com:jayvee/custom-origin.git\n'; },
        pathExists: (p) => p === path.join('/tmp/brewboard', '.git'),
    });
    a.deepStrictEqual(urls.sort(), [
        'git@github.com:jayvee/custom-origin.git',
        'https://github.com/jayvee/brewboard-seed.git',
        'https://github.com/jayvee/brewboard.git',
    ].sort());
    a.strictEqual(calls.length, 1);
});

test('parseSeedResetRemoteHeads extracts branch names from ls-remote output', () => {
    const parsed = parseSeedResetRemoteHeads(['sha1\trefs/heads/feature-12-test', 'sha2\trefs/heads/research-04-topic', ''].join('\n'));
    a.deepStrictEqual(parsed, ['feature-12-test', 'research-04-topic']);
});

test('cleanupSeedResetRemoteBranches creates a temporary helper repo when local repo is gone', () => {
    const calls = [];
    const removed = [];
    const fakeFs = {
        existsSync: () => false,
        mkdtempSync: () => '/tmp/aigon-seed-reset-123',
        rmSync: (target) => removed.push(target),
    };
    const result = cleanupSeedResetRemoteBranches({
        remoteUrls: ['https://github.com/jayvee/brewboard.git'], repoPath: '/tmp/missing-repo', repoExists: false,
        fsLib: fakeFs, osLib: { tmpdir: () => '/tmp' }, pathLib: path,
        execFn: (cmd, options) => {
            calls.push({ cmd, cwd: options && options.cwd });
            if (cmd === 'git init -q') return '';
            if (cmd.startsWith('git ls-remote')) return 'sha1\trefs/heads/feature-12-test\nsha2\trefs/heads/research-04-topic\n';
            if (cmd.startsWith('git push ')) return '';
            throw new Error(`unexpected command: ${cmd}`);
        },
    });
    a.strictEqual(result.helperRepoCreated, true);
    a.deepStrictEqual(result.deletedByRemote['https://github.com/jayvee/brewboard.git'], ['feature-12-test', 'research-04-topic']);
    a.deepStrictEqual(calls.map(c => c.cmd), [
        'git init -q',
        'git ls-remote --heads "https://github.com/jayvee/brewboard.git" \'feature-*\' \'research-*\'',
        'git push "https://github.com/jayvee/brewboard.git" :refs/heads/feature-12-test :refs/heads/research-04-topic',
    ]);
    a.ok(calls.every(c => c.cwd === '/tmp/aigon-seed-reset-123'));
    a.deepStrictEqual(removed, ['/tmp/aigon-seed-reset-123']);
});

test('cleanupSeedResetRemoteBranches reuses the repo cwd when a local repo exists', () => {
    const calls = [];
    const result = cleanupSeedResetRemoteBranches({
        remoteUrls: ['https://github.com/jayvee/brewboard.git'], repoPath: '/tmp/repo', repoExists: true,
        fsLib: { existsSync: (p) => p === path.join('/tmp/repo', '.git') }, osLib: { tmpdir: () => '/tmp' }, pathLib: path,
        execFn: (cmd, options) => {
            calls.push({ cmd, cwd: options && options.cwd });
            if (cmd.startsWith('git ls-remote')) return '';
            throw new Error(`unexpected command: ${cmd}`);
        },
    });
    a.strictEqual(result.helperRepoCreated, false);
    a.deepStrictEqual(calls, [{
        cmd: 'git ls-remote --heads "https://github.com/jayvee/brewboard.git" \'feature-*\' \'research-*\'',
        cwd: '/tmp/repo',
    }]);
});

test('stripSeedResetStaleConfigKeys removes stale keys and preserves the rest', () => withTempDir((dir) => {
    const configPath = path.join(dir, '.aigon', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ pro: { enabled: true }, honourRemoteBranchGate: true }, null, 2) + '\n');
    const removed = stripSeedResetStaleConfigKeys(configPath, ['pro']);
    a.deepStrictEqual(removed, ['pro']);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    a.deepStrictEqual(parsed, { honourRemoteBranchGate: true });
}));

test('closeSeedResetOpenPullRequests closes only open feature/research PRs', () => {
    const calls = [];
    const result = closeSeedResetOpenPullRequests({
        remoteUrl: 'https://github.com/jayvee/brewboard.git',
        execFn: (cmd) => {
            calls.push(cmd);
            if (cmd === 'gh --version') return 'gh version 2.0.0\n';
            if (cmd === 'gh auth status') return 'ok\n';
            if (cmd.startsWith('gh pr list --repo "jayvee/brewboard"')) {
                return JSON.stringify([
                    { number: 11, headRefName: 'feature-04-cc-rating-system' },
                    { number: 12, headRefName: 'research-02-something' },
                    { number: 13, headRefName: 'chore-docs' },
                ]);
            }
            if (cmd.startsWith('gh pr close 11 ')) return '';
            if (cmd.startsWith('gh pr close 12 ')) return '';
            throw new Error(`unexpected command: ${cmd}`);
        },
    });
    a.deepStrictEqual(result.closed, [11, 12]);
});

report();
