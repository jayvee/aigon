'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const GIT_SAFE_ENV = Object.freeze({
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/usr/bin/true',
    GIT_AUTHOR_NAME: 'Aigon Test',
    GIT_AUTHOR_EMAIL: 'test@aigon.test',
    GIT_COMMITTER_NAME: 'Aigon Test',
    GIT_COMMITTER_EMAIL: 'test@aigon.test',
});

let passed = 0;
let failed = 0;
const asyncTests = [];

const _ok = (d) => { console.log(`  ✓ ${d}`); passed++; };
const _err = (d, e) => { console.error(`  ✗ ${d}\n    ${e.stack || e.message}`); failed++; };

function test(description, fn) {
    try { fn(); _ok(description); } catch (e) { _err(description, e); }
}

function testAsync(description, fn) {
    asyncTests.push(
        Promise.resolve().then(fn).then(() => _ok(description)).catch((e) => _err(description, e))
    );
}

function _resolvePrefix(prefix, fn) {
    if (typeof prefix === 'function') return [fn || prefix, 'aigon-test-'];
    return [fn, prefix];
}

function withTempDir(prefix, fn) {
    const [body, p] = _resolvePrefix(prefix, fn);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), p));
    try { return body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function withTempDirAsync(prefix, fn) {
    const [body, p] = _resolvePrefix(prefix, fn);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), p));
    try { return await body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function report() {
    if (asyncTests.length > 0) await Promise.all(asyncTests);
    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

const ENTITY_STAGE_DIRS = Object.freeze(['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused']);

function seedEntityDirs(repo, kind) {
    ENTITY_STAGE_DIRS.forEach((dir) => fs.mkdirSync(path.join(repo, 'docs', 'specs', kind, dir), { recursive: true }));
}

function writeSpec(repo, kind, stage, file) {
    fs.writeFileSync(path.join(repo, 'docs', 'specs', kind, stage, file), `# ${file}\n`);
}

function writeSnap(repo, kind, id, lifecycle) {
    const dir = path.join(repo, '.aigon', 'workflows', kind, String(id));
    fs.mkdirSync(dir, { recursive: true });
    const entityType = kind === 'features' ? 'feature' : 'research';
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({
        entityType, [`${entityType}Id`]: String(id), currentSpecState: lifecycle, lifecycle,
        mode: 'solo_branch', agents: { cx: { status: 'running' } },
        createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:05:00Z',
    }));
}

function withRepoCwd(repo, fn) {
    const prev = process.cwd();
    process.chdir(repo);
    try {
        return fn();
    } finally {
        process.chdir(prev);
        process.exitCode = 0;
    }
}

// Shared CLI/git boilerplate used across ~10 integration tests.
const { execFileSync, spawnSync } = require('child_process');
const CLI_PATH = path.join(__dirname, '..', 'aigon-cli.js');

function createIsolatedTmuxEnv(baseEnv = process.env) {
    const tmuxTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-tmux-'));
    const env = { ...baseEnv, TMUX_TMPDIR: tmuxTmpDir };
    delete env.TMUX;
    return { env, tmuxTmpDir };
}

function killIsolatedTmuxServer(tmuxTmpDir) {
    if (!tmuxTmpDir) return;
    const env = { ...process.env, TMUX_TMPDIR: tmuxTmpDir };
    delete env.TMUX;
    spawnSync('tmux', ['kill-server'], { stdio: 'ignore', env });
}

function withIsolatedTmux(fn) {
    const previousTmux = process.env.TMUX;
    const previousTmuxTmpDir = process.env.TMUX_TMPDIR;
    const { tmuxTmpDir } = createIsolatedTmuxEnv();
    process.env.TMUX_TMPDIR = tmuxTmpDir;
    delete process.env.TMUX;
    try {
        return fn({ tmuxTmpDir });
    } finally {
        killIsolatedTmuxServer(tmuxTmpDir);
        if (previousTmux === undefined) delete process.env.TMUX;
        else process.env.TMUX = previousTmux;
        if (previousTmuxTmpDir === undefined) delete process.env.TMUX_TMPDIR;
        else process.env.TMUX_TMPDIR = previousTmuxTmpDir;
        fs.rmSync(tmuxTmpDir, { recursive: true, force: true });
    }
}

async function withIsolatedTmuxAsync(fn) {
    const previousTmux = process.env.TMUX;
    const previousTmuxTmpDir = process.env.TMUX_TMPDIR;
    const { tmuxTmpDir } = createIsolatedTmuxEnv();
    process.env.TMUX_TMPDIR = tmuxTmpDir;
    delete process.env.TMUX;
    try {
        return await fn({ tmuxTmpDir });
    } finally {
        killIsolatedTmuxServer(tmuxTmpDir);
        if (previousTmux === undefined) delete process.env.TMUX;
        else process.env.TMUX = previousTmux;
        if (previousTmuxTmpDir === undefined) delete process.env.TMUX_TMPDIR;
        else process.env.TMUX_TMPDIR = previousTmuxTmpDir;
        fs.rmSync(tmuxTmpDir, { recursive: true, force: true });
    }
}

function initGitRepo(root, { seedCommit = true, branch } = {}) {
    const env = { ...process.env, ...GIT_SAFE_ENV };
    execFileSync('git', ['init', '-q'], { cwd: root, env, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: root, env, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: root, env, stdio: 'pipe' });
    if (branch) execFileSync('git', ['checkout', '-qb', branch], { cwd: root, env, stdio: 'pipe' });
    if (seedCommit) {
        fs.writeFileSync(path.join(root, '.gitkeep'), '');
        execFileSync('git', ['add', '.gitkeep'], { cwd: root, env, stdio: 'pipe' });
        execFileSync('git', ['commit', '-m', 'chore: init'], { cwd: root, env, stdio: 'pipe' });
    }
}

function runAigonCli(repo, args, { expectFail = false, extraEnv = {} } = {}) {
    const r = spawnSync('node', [CLI_PATH, ...args], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, ...extraEnv },
        encoding: 'utf8',
    });
    const output = (r.stdout || '') + (r.stderr || '');
    if (!expectFail && r.status !== 0) {
        throw new Error(`aigon ${args.join(' ')} failed (status ${r.status}):\n${output}`);
    }
    return { stdout: r.stdout || '', stderr: r.stderr || '', code: r.status ?? 1, output };
}

module.exports = {
    test, testAsync, withTempDir, withTempDirAsync, report,
    GIT_SAFE_ENV, ENTITY_STAGE_DIRS, seedEntityDirs, writeSpec, writeSnap, withRepoCwd,
    initGitRepo, runAigonCli, CLI_PATH,
    createIsolatedTmuxEnv, killIsolatedTmuxServer, withIsolatedTmux, withIsolatedTmuxAsync,
};
