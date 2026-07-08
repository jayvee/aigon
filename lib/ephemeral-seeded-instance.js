'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { STAGE_FOLDERS } = require('./workflow-core/paths');

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

const DEFAULT_FIXTURES_DIR = path.join(os.homedir(), 'src');

const E2E_SEED_FEATURES = [
    { title: 'e2e solo feature', slug: 'e2e-solo-feature' },
    { title: 'e2e fleet feature', slug: 'e2e-fleet-feature' },
    { title: 'e2e drive feature', slug: 'e2e-drive-feature' },
    { title: 'e2e close failure feature', slug: 'e2e-close-failure-feature' },
    { title: 'e2e mark complete feature', slug: 'e2e-mark-complete-feature' },
];

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function runGit(args, cwd) {
    spawnSync('git', args, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, encoding: 'utf8', stdio: 'pipe' });
}

function runAigon(cliPath, args, cwd, extraEnv = {}) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd,
        env: { ...process.env, HOME: os.tmpdir(), AIGON_TEST_MODE: '1', ...GIT_SAFE_ENV, ...extraEnv },
        encoding: 'utf8',
        stdio: 'pipe',
    });
}

function assertAigonOk(result, args) {
    if (result.status === 0) return;
    throw new Error(`aigon ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
}

function ensureFixtureRepo(fixtureName = 'brewboard', fixturesDir = DEFAULT_FIXTURES_DIR) {
    const fixturePath = path.join(fixturesDir, fixtureName);
    if (fs.existsSync(fixturePath)) return fixturePath;
    const setupScript = path.join(__dirname, '..', 'scripts', 'setup-fixture.js');
    if (!fs.existsSync(setupScript)) {
        throw new Error(`Fixture ${fixtureName} missing at ${fixturePath} and setup-fixture.js not found`);
    }
    const r = spawnSync(process.execPath, [setupScript], { encoding: 'utf8', stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`Fixture generation failed for ${fixtureName}`);
    if (!fs.existsSync(fixturePath)) {
        throw new Error(`Fixture ${fixtureName} still missing after setup-fixture.js`);
    }
    return fixturePath;
}

function createEmptyFixtureRepo(repoPath) {
    fs.mkdirSync(path.join(repoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.INBOX), { recursive: true });
    runGit(['init', '-q'], repoPath);
    runGit(['config', 'user.email', 'test@aigon.test'], repoPath);
    runGit(['config', 'user.name', 'Aigon Test'], repoPath);
}

function clearFixtureInbox(repoPath) {
    const fixtureInbox = path.join(repoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.INBOX);
    if (!fs.existsSync(fixtureInbox)) return;
    for (const f of fs.readdirSync(fixtureInbox)) {
        fs.rmSync(path.join(fixtureInbox, f), { force: true, recursive: true });
    }
}

function seedE2eFeatures(repoPath, cliPath) {
    clearFixtureInbox(repoPath);
    for (const { title, slug } of E2E_SEED_FEATURES) {
        assertAigonOk(runAigon(cliPath, ['feature-create', title], repoPath), ['feature-create', title]);
        assertAigonOk(runAigon(cliPath, ['feature-prioritise', slug], repoPath), ['feature-prioritise', slug]);
    }
}

/**
 * Provision a throwaway AIGON_HOME + seeded fixture repo (shared by e2e bootstrap and preview --sandbox).
 * @param {{ fixture?: string, seedE2eFeatures?: boolean, cliPath?: string, repoPrefix?: string, homePrefix?: string, fixturesDir?: string }} [options]
 * @returns {{ tempHome: string, repoPath: string, tmuxTmpDir: string, aigonConfigPath: string }}
 */
function provisionEphemeralSeededInstance(options = {}) {
    const fixture = options.fixture || 'brewboard';
    const cliPath = options.cliPath || path.join(__dirname, '..', 'aigon-cli.js');
    const repoPrefix = options.repoPrefix || 'aigon-sandbox-repo-';
    const homePrefix = options.homePrefix || 'aigon-sandbox-home-';

    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), repoPrefix));
    if (fixture === 'empty') {
        createEmptyFixtureRepo(repoPath);
    } else {
        const fixtureSrc = ensureFixtureRepo(fixture, options.fixturesDir);
        copyDir(fixtureSrc, repoPath);
        runGit(['config', 'user.email', 'test@aigon.test'], repoPath);
        runGit(['config', 'user.name', 'Aigon Test'], repoPath);
    }

    if (options.seedE2eFeatures) {
        seedE2eFeatures(repoPath, cliPath);
    }

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), homePrefix));
    const aigonDir = path.join(tempHome, '.aigon');
    fs.mkdirSync(aigonDir, { recursive: true });
    const tmuxTmpDir = path.join(tempHome, '.tmux');
    fs.mkdirSync(tmuxTmpDir, { recursive: true, mode: 0o700 });
    const aigonConfigPath = path.join(aigonDir, 'config.json');
    fs.writeFileSync(aigonConfigPath, JSON.stringify({ repos: [repoPath] }, null, 2));

    return { tempHome, repoPath, tmuxTmpDir, aigonConfigPath };
}

/**
 * Remove temp home and repo directories created by provisionEphemeralSeededInstance.
 * @param {{ tempHome?: string, repoPath?: string }} instance
 */
function destroyEphemeralSeededInstance(instance = {}) {
    for (const dir of [instance.tempHome, instance.repoPath]) {
        if (!dir || !fs.existsSync(dir)) continue;
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (_) { /* best-effort */ }
    }
}

module.exports = {
    GIT_SAFE_ENV,
    DEFAULT_FIXTURES_DIR,
    E2E_SEED_FEATURES,
    copyDir,
    ensureFixtureRepo,
    provisionEphemeralSeededInstance,
    destroyEphemeralSeededInstance,
    seedE2eFeatures,
};
