#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');

function gitRun(cwd, args) {
    return execFileSync('git', args, {
        cwd,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
}

function initRepo(dir) {
    gitRun(dir, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
    gitRun(dir, ['add', '.']);
    gitRun(dir, ['commit', '-q', '-m', 'chore: seed']);
}


function buildStubReqRes(reqUrl) {
    const req = { url: reqUrl, headers: { host: 'localhost:5174' } };
    let statusCode = null;
    let body = null;
    const res = {
        writeHead(code) { statusCode = code; },
        end(payload) { body = payload; }
    };
    return { req, res, getStatusCode: () => statusCode, getBody: () => (body ? JSON.parse(body) : null) };
}

function buildStubServerCtx(repoPath) {
    return {
        state: {
            getLatestStatus: () => null,
            setLatestStatus: () => {},
            getGlobalConfig: () => ({}),
            setGlobalConfig: () => {},
            getNotificationUnreadCount: () => 0,
            setNotificationUnreadCount: () => {},
        },
        helpers: {
            resolveRequestedRepoPathOrRespond: (_res, requested) => requested || repoPath,
        },
        routes: {},
        options: {},
    };
}

test('worktree path: returns commits ahead of main', () => {
    withTempDir((repo) => {
        initRepo(repo);

        // Simulate a worktree dir matching feature-{id}-{agent}-{desc} living
        // under ~/.aigon/worktrees/{repoName}. We override HOME so the route's
        // findFeatureWorktree() looks in our temp tree.
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-home-'));
        const repoName = path.basename(repo);
        const worktreeBase = path.join(fakeHome, '.aigon', 'worktrees', repoName);
        fs.mkdirSync(worktreeBase, { recursive: true });
        const worktreePath = path.join(worktreeBase, 'feature-77-cc-add-thing');
        gitRun(repo, ['worktree', 'add', '-q', '-b', 'feature-77-cc-add-thing', worktreePath]);

        // Add two commits
        fs.writeFileSync(path.join(worktreePath, 'a.txt'), 'one\n');
        gitRun(worktreePath, ['add', '.']);
        gitRun(worktreePath, ['commit', '-q', '-m', 'feat: first']);
        fs.writeFileSync(path.join(worktreePath, 'b.txt'), 'two\nthree\n');
        gitRun(worktreePath, ['add', '.']);
        gitRun(worktreePath, ['commit', '-q', '-m', 'feat: second']);

        const prevHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            const ctx = buildStubServerCtx(repo);
            const dispatcher = createDashboardRouteDispatcher(ctx);
            const { req, res, getStatusCode, getBody } = buildStubReqRes(`/api/feature/77/commits?repoPath=${encodeURIComponent(repo)}`);
            const matched = dispatcher.dispatchOssRoute('GET', '/api/feature/77/commits', req, res);
            assert.strictEqual(matched, true);
            assert.strictEqual(getStatusCode(), 200);
            const body = getBody();
            assert.strictEqual(body.source, 'worktree');
            assert.strictEqual(body.commits.length, 2);
            assert.strictEqual(body.commits[0].message, 'feat: second');
            assert.strictEqual(body.commits[1].message, 'feat: first');
            // Files attached
            const files = body.commits[0].files;
            assert.ok(Array.isArray(files));
            const bFile = files.find(f => f.path === 'b.txt');
            assert.ok(bFile, 'b.txt should appear in second commit');
            assert.strictEqual(bFile.added, 2);
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });
});

test('merged path: finds commits via merge-grep when worktree is gone', () => {
    withTempDir((repo) => {
        initRepo(repo);

        // Create a feature branch with two commits, then merge --no-ff with the
        // canonical "Merge feature {id}" commit message.
        gitRun(repo, ['checkout', '-q', '-b', 'feature-99-cc-thing']);
        fs.writeFileSync(path.join(repo, 'x.txt'), 'x\n');
        gitRun(repo, ['add', '.']);
        gitRun(repo, ['commit', '-q', '-m', 'feat: x']);
        fs.writeFileSync(path.join(repo, 'y.txt'), 'y\n');
        gitRun(repo, ['add', '.']);
        gitRun(repo, ['commit', '-q', '-m', 'feat: y']);

        gitRun(repo, ['checkout', '-q', 'main']);
        gitRun(repo, ['merge', '--no-ff', 'feature-99-cc-thing', '-m', 'Merge feature 99 from agent cc']);

        // Run with a HOME that has no worktree dir, so route falls through to merged path.
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            const ctx = buildStubServerCtx(repo);
            const dispatcher = createDashboardRouteDispatcher(ctx);
            const { req, res, getStatusCode, getBody } = buildStubReqRes(`/api/feature/99/commits?repoPath=${encodeURIComponent(repo)}`);
            dispatcher.dispatchOssRoute('GET', '/api/feature/99/commits', req, res);
            assert.strictEqual(getStatusCode(), 200);
            const body = getBody();
            assert.strictEqual(body.source, 'merged');
            assert.strictEqual(body.commits.length, 2);
            const messages = body.commits.map(c => c.message).sort();
            assert.deepStrictEqual(messages, ['feat: x', 'feat: y']);
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });
});

test('merged path: returns empty array when no merge commit found', () => {
    withTempDir((repo) => {
        initRepo(repo);
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            const ctx = buildStubServerCtx(repo);
            const dispatcher = createDashboardRouteDispatcher(ctx);
            const { req, res, getStatusCode, getBody } = buildStubReqRes(`/api/feature/123/commits?repoPath=${encodeURIComponent(repo)}`);
            dispatcher.dispatchOssRoute('GET', '/api/feature/123/commits', req, res);
            assert.strictEqual(getStatusCode(), 200);
            const body = getBody();
            assert.strictEqual(body.source, 'merged');
            assert.deepStrictEqual(body.commits, []);
            assert.strictEqual(body.mergeCommit, null);
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });
});

test('rejects non-numeric ids', () => {
    withTempDir((repo) => {
        initRepo(repo);
        const ctx = buildStubServerCtx(repo);
        const dispatcher = createDashboardRouteDispatcher(ctx);
        const { req, res, getStatusCode } = buildStubReqRes(`/api/feature/abc/commits?repoPath=${encodeURIComponent(repo)}`);
        dispatcher.dispatchOssRoute('GET', '/api/feature/abc/commits', req, res);
        assert.strictEqual(getStatusCode(), 400);
    });
});

test('accepts plural /api/features/:id/commits as well as singular', () => {
    withTempDir((repo) => {
        initRepo(repo);
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            const ctx = buildStubServerCtx(repo);
            const dispatcher = createDashboardRouteDispatcher(ctx);
            const { req, res, getStatusCode } = buildStubReqRes(`/api/features/55/commits?repoPath=${encodeURIComponent(repo)}`);
            const matched = dispatcher.dispatchOssRoute('GET', '/api/features/55/commits', req, res);
            assert.strictEqual(matched, true);
            assert.strictEqual(getStatusCode(), 200);
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });
});

report();
