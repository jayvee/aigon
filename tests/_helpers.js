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

module.exports = { test, testAsync, withTempDir, withTempDirAsync, report, GIT_SAFE_ENV, ENTITY_STAGE_DIRS, seedEntityDirs, writeSpec, writeSnap, withRepoCwd };
