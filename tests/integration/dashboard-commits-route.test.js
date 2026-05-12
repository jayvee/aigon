#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
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
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const res = {
        writeHead(code) { statusCode = code; },
        end(payload) { body = payload; resolveDone(); },
    };
    return { req, res, done, getStatusCode: () => statusCode, getBody: () => (body ? JSON.parse(body) : null) };
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

testAsync('worktree path: returns commits ahead of main', () =>
    withTempDirAsync(async (repo) => {
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
            const { req, res, done, getStatusCode, getBody } = buildStubReqRes(`/api/feature/77/commits?repoPath=${encodeURIComponent(repo)}`);
            const matched = dispatcher.dispatchOssRoute('GET', '/api/feature/77/commits', req, res);
            assert.strictEqual(matched, true);
            await done;
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
    })
);

testAsync('merged path: finds commits via merge-grep when worktree is gone', () =>
    withTempDirAsync(async (repo) => {
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
            const { req, res, done, getStatusCode, getBody } = buildStubReqRes(`/api/feature/99/commits?repoPath=${encodeURIComponent(repo)}`);
            dispatcher.dispatchOssRoute('GET', '/api/feature/99/commits', req, res);
            await done;
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
    })
);

testAsync('worktree path: filters commits with Aigon-Internal: true trailer', () =>
    withTempDirAsync(async (repo) => {
        initRepo(repo);

        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-home-'));
        const repoName = path.basename(repo);
        const worktreeBase = path.join(fakeHome, '.aigon', 'worktrees', repoName);
        fs.mkdirSync(worktreeBase, { recursive: true });
        const worktreePath = path.join(worktreeBase, 'feature-88-cc-thing');
        gitRun(repo, ['worktree', 'add', '-q', '-b', 'feature-88-cc-thing', worktreePath]);

        // Plumbing commit — should be hidden
        fs.writeFileSync(path.join(worktreePath, '.gitignore'), '');
        gitRun(worktreePath, ['add', '.']);
        gitRun(worktreePath, ['commit', '-q', '-m', 'chore: worktree setup for cc', '--trailer', 'Aigon-Internal: true']);

        // Content commit — should be visible
        fs.writeFileSync(path.join(worktreePath, 'real.txt'), 'content\n');
        gitRun(worktreePath, ['add', '.']);
        gitRun(worktreePath, ['commit', '-q', '-m', 'feat: real work']);

        const prevHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            const ctx = buildStubServerCtx(repo);
            const dispatcher = createDashboardRouteDispatcher(ctx);
            const { req, res, done, getStatusCode, getBody } = buildStubReqRes(`/api/feature/88/commits?repoPath=${encodeURIComponent(repo)}`);
            dispatcher.dispatchOssRoute('GET', '/api/feature/88/commits', req, res);
            await done;
            assert.strictEqual(getStatusCode(), 200);
            const body = getBody();
            assert.strictEqual(body.source, 'worktree');
            assert.strictEqual(body.commits.length, 1, 'plumbing commit must be filtered out');
            assert.strictEqual(body.commits[0].message, 'feat: real work');
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    })
);

testAsync('dispatcher: rejects non-numeric ids (400) and accepts plural /api/features/:id/commits', () =>
    withTempDirAsync(async (repo) => {
        initRepo(repo);
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            const ctx = buildStubServerCtx(repo);
            const dispatcher = createDashboardRouteDispatcher(ctx);
            const bad = buildStubReqRes(`/api/feature/abc/commits?repoPath=${encodeURIComponent(repo)}`);
            dispatcher.dispatchOssRoute('GET', '/api/feature/abc/commits', bad.req, bad.res);
            await bad.done;
            assert.strictEqual(bad.getStatusCode(), 400);

            const plural = buildStubReqRes(`/api/features/55/commits?repoPath=${encodeURIComponent(repo)}`);
            const matched = dispatcher.dispatchOssRoute('GET', '/api/features/55/commits', plural.req, plural.res);
            assert.strictEqual(matched, true);
            await plural.done;
            assert.strictEqual(plural.getStatusCode(), 200);
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    })
);

report();
