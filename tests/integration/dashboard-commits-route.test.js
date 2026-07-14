#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV, initGitRepo } = require('../_helpers');
const { createDashboardRouteDispatcher } = require('../../lib/dashboard-routes');
const { _internals: commitsInternals } = require('../../lib/dashboard-routes/commits');

const git = (cwd, ...args) => execFileSync('git', args, {
    cwd, env: { ...process.env, ...GIT_SAFE_ENV }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

function commitFile(repo, file, content, message) {
    fs.writeFileSync(path.join(repo, file), content);
    git(repo, 'add', file);
    git(repo, 'commit', '-q', '-m', message);
    return git(repo, 'rev-parse', 'HEAD');
}

function createWorktree(repo, home, branch) {
    const dir = path.join(home, '.aigon', 'worktrees', path.basename(repo), branch);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', branch, dir);
    return dir;
}

async function withHome(fn) {
    return withTempDirAsync('aigon-home-', async (home) => {
        const previous = process.env.HOME;
        process.env.HOME = home;
        try { return await fn(home); } finally { process.env.HOME = previous; }
    });
}

function serverCtx(repo) {
    return {
        state: {
            getLatestStatus: () => null, setLatestStatus: () => {}, getGlobalConfig: () => ({}),
            setGlobalConfig: () => {}, getNotificationUnreadCount: () => 0, setNotificationUnreadCount: () => {},
        },
        helpers: { resolveRequestedRepoPathOrRespond: (_res, requested) => requested || repo },
        routes: {}, options: {},
    };
}

async function request(repo, routePath, url = `${routePath}?repoPath=${encodeURIComponent(repo)}`) {
    let statusCode;
    let body;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const req = { url, headers: { host: 'localhost:5174' } };
    const res = {
        writeHead(code) { statusCode = code; },
        end(payload) { body = payload ? JSON.parse(payload) : null; finish(); },
    };
    const matched = createDashboardRouteDispatcher(serverCtx(repo)).dispatchOssRoute('GET', routePath, req, res);
    await done;
    return { matched, statusCode, body };
}

function mergeBranch(repo, id, agent, changes) {
    const branch = `feature-${id}-${agent}-test`;
    git(repo, 'checkout', '-q', '-b', branch);
    const hashes = changes.map(([file, content, message]) => commitFile(repo, file, content, message));
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'merge', '--no-ff', branch, '-m', `Merge feature ${id} from agent ${agent}`);
    return hashes;
}

testAsync('worktree route returns ordered commits and file stats', () => withTempDirAsync(async (repo) => {
    initGitRepo(repo, { branch: 'main' });
    await withHome(async (home) => {
        const worktree = createWorktree(repo, home, 'feature-77-cc-add-thing');
        commitFile(worktree, 'a.txt', 'one\n', 'feat: first');
        commitFile(worktree, 'b.txt', 'two\nthree\n', 'feat: second');
        const { matched, statusCode, body } = await request(repo, '/api/feature/77/commits');
        assert.strictEqual(matched, true);
        assert.strictEqual(statusCode, 200);
        assert.deepStrictEqual(body.commits.map(commit => commit.message), ['feat: second', 'feat: first']);
        assert.strictEqual(body.source, 'worktree');
        assert.strictEqual(body.commits[0].files.find(file => file.path === 'b.txt').added, 2);
    });
}));

testAsync('diff route returns a textual worktree patch', () => withTempDirAsync(async (repo) => {
    initGitRepo(repo, { branch: 'main' });
    await withHome(async (home) => {
        const worktree = createWorktree(repo, home, 'feature-78-cx-show-diff');
        commitFile(worktree, 'diff.txt', 'old\n', 'feat: add diff file');
        const hash = commitFile(worktree, 'diff.txt', 'old\nnew\n', 'feat: update diff file');
        const route = `/api/feature/78/commits/${hash}/diff`;
        const result = await request(repo, route, `${route}?repoPath=${encodeURIComponent(repo)}&path=diff.txt`);
        assert.strictEqual(result.statusCode, 200);
        assert.deepStrictEqual(
            (({ source, path: file, binary, truncated }) => ({ source, file, binary, truncated }))(result.body),
            { source: 'worktree', file: 'diff.txt', binary: false, truncated: false }
        );
        assert.match(result.body.diff, /^@@ /m);
        assert.match(result.body.diff, /^\+new$/m);
    });
}));

testAsync('diff route handles binary and truncated merged files', () => withTempDirAsync(async (repo) => {
    initGitRepo(repo, { branch: 'main' });
    const [binaryHash] = mergeBranch(repo, '909080', 'cx', [['image.bin', Buffer.from([0, 1, 2, 3, 0]), 'feat: binary']]);
    const binaryRoute = `/api/features/909080/commits/${binaryHash}/diff`;
    const binary = await request(repo, binaryRoute, `${binaryRoute}?repoPath=${encodeURIComponent(repo)}&path=image.bin`);
    assert.strictEqual(binary.body.binary, true);
    assert.strictEqual(binary.body.diff, '');

    const lines = Array.from({ length: 26000 }, (_, i) => `line-${i}`).join('\n') + '\n';
    const [largeHash] = mergeBranch(repo, '909081', 'cx', [['large.txt', lines, 'feat: large diff']]);
    const largeRoute = `/api/feature/909081/commits/${largeHash}/diff`;
    const large = await request(repo, largeRoute, `${largeRoute}?repoPath=${encodeURIComponent(repo)}&path=large.txt`);
    assert.strictEqual(large.body.truncated, true);
    assert.ok(Buffer.byteLength(large.body.diff) <= commitsInternals.MAX_FILE_DIFF_BYTES);
    assert.match(large.body.diff, /^@@ /m);
}));

testAsync('merged route finds feature commits after worktree removal', () => withTempDirAsync(async (repo) => {
    initGitRepo(repo, { branch: 'main' });
    mergeBranch(repo, '99', 'cc', [['x.txt', 'x\n', 'feat: x'], ['y.txt', 'y\n', 'feat: y']]);
    await withHome(async () => {
        const { statusCode, body } = await request(repo, '/api/feature/99/commits');
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(body.source, 'merged');
        assert.deepStrictEqual(body.commits.map(commit => commit.message).sort(), ['feat: x', 'feat: y']);
    });
}));

testAsync('merged route ignores orphaned worktree directories', () => withTempDirAsync(async (repo) => {
    initGitRepo(repo, { branch: 'main' });
    mergeBranch(repo, '79', 'cx', [['orphan.txt', 'merged\n', 'feat: merged work']]);
    await withHome(async (home) => {
        const orphan = path.join(home, '.aigon', 'worktrees', path.basename(repo), 'feature-79-cx-orphan');
        fs.mkdirSync(orphan, { recursive: true });
        const { body } = await request(repo, '/api/feature/79/commits');
        assert.strictEqual(body.source, 'merged');
        assert.deepStrictEqual(body.commits.map(commit => commit.message), ['feat: merged work']);
    });
}));

testAsync('worktree route filters Aigon-Internal commits', () => withTempDirAsync(async (repo) => {
    initGitRepo(repo, { branch: 'main' });
    await withHome(async (home) => {
        const worktree = createWorktree(repo, home, 'feature-88-cc-thing');
        fs.writeFileSync(path.join(worktree, '.gitignore'), '');
        git(worktree, 'add', '.gitignore');
        git(worktree, 'commit', '-q', '-m', 'chore: setup', '--trailer', 'Aigon-Internal: true');
        commitFile(worktree, 'real.txt', 'content\n', 'feat: real work');
        const { body } = await request(repo, '/api/feature/88/commits');
        assert.deepStrictEqual(body.commits.map(commit => commit.message), ['feat: real work']);
    });
}));

testAsync('dispatcher rejects non-numeric IDs and accepts plural routes', () => withTempDirAsync(async (repo) => {
    initGitRepo(repo, { branch: 'main' });
    await withHome(async () => {
        assert.strictEqual((await request(repo, '/api/feature/abc/commits')).statusCode, 400);
        const plural = await request(repo, '/api/features/55/commits');
        assert.strictEqual(plural.matched, true);
        assert.strictEqual(plural.statusCode, 200);
    });
}));

report();
