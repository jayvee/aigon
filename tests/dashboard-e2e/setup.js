// @ts-check
'use strict';

/**
 * Playwright globalSetup for dashboard e2e tests.
 *
 * Creates a temp fixture (copy of brewboard), starts a real dashboard server
 * on port 4119 pointed at the fixture, and writes context to a temp JSON file
 * so tests can find the fixture dir, worktree base, and dashboard PID.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { GIT_SAFE_ENV } = require('../_helpers');

const ROOT = path.join(__dirname, '..', '..');
const CLI_PATH = path.join(ROOT, 'aigon-cli.js');
const FIXTURES_DIR = path.join(os.homedir(), 'src');
const MOCK_BIN_DIR = path.join(ROOT, 'tests', 'integration', 'mock-bin');

/** Shared context file path — tests read this to locate fixture dirs */
const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');
exports.CTX_FILE = CTX_FILE;

const PORT = 4119;
exports.PORT = PORT;

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}

function ensureFixtures() {
    if (!fs.existsSync(path.join(FIXTURES_DIR, 'brewboard'))) {
        console.log('[e2e-setup] Fixtures missing — generating...');
        const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-fixture.js')], {
            encoding: 'utf8',
            stdio: 'inherit',
        });
        if (result.status !== 0) throw new Error('Fixture generation failed');
    }
}

function runAigon(args, cwd) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd,
        env: { ...process.env, HOME: os.tmpdir(), ...GIT_SAFE_ENV },
        encoding: 'utf8',
        stdio: 'pipe',
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.status };
}

function runGit(args, cwd) {
    spawnSync('git', args, {
        cwd,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
        stdio: 'pipe',
    });
}

function waitForServer(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        function attempt() {
            http.get(url, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                if (Date.now() > deadline) {
                    reject(new Error(`Server at ${url} did not start within ${timeoutMs}ms`));
                } else {
                    setTimeout(attempt, 300);
                }
            });
        }
        attempt();
    });
}

module.exports = async function globalSetup() {
    ensureFixtures();

    // ── Create temp fixture (copy of brewboard) ────────────────────────────────
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-dashboard-'));
    copyDir(path.join(FIXTURES_DIR, 'brewboard'), tmpDir);
    runGit(['config', 'user.email', 'test@aigon.test'], tmpDir);
    runGit(['config', 'user.name', 'Aigon Test'], tmpDir);

    // Pre-create test features in inbox (IDs assigned later via dashboard Prioritise action)
    runAigon(['feature-create', 'e2e-solo-feature'], tmpDir);
    runAigon(['feature-create', 'e2e-fleet-feature'], tmpDir);
    runAigon(['feature-create', 'e2e-drive-feature'], tmpDir);

    // ── Create temp home with .aigon/config.json ───────────────────────────────
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-home-'));
    const aigonDir = path.join(tempHome, '.aigon');
    fs.mkdirSync(aigonDir, { recursive: true });

    // Worktree base: aigon v2.51+ uses ~/.aigon/worktrees/{repoName}/ — the
    // dashboard process below has HOME=tempHome, so worktrees will land under
    // tempHome/.aigon/worktrees/{repoName}/.
    const worktreeBase = path.join(tempHome, '.aigon', 'worktrees', path.basename(tmpDir));
    fs.writeFileSync(
        path.join(aigonDir, 'config.json'),
        JSON.stringify({ repos: [tmpDir] }, null, 2)
    );

    // ── Start real dashboard server ────────────────────────────────────────────
    const dashEnv = {
        ...process.env,
        HOME: tempHome,
        PORT: String(PORT),
        // Real tmux runs in the background (no GUI terminal pops up) because
        // AIGON_TEST_MODE=1 makes openSingleWorktree skip the terminal-app open.
        // Sessions are cleaned up in teardown.js by killing anything matching
        // the fixture's repo-name prefix.
        AIGON_TEST_MODE: '1',
        // GEMINI_CLI=1 makes feature-eval run in eval-setup mode (no agent launch)
        GEMINI_CLI: '1',
        // Force Pro availability for the whole dashboard process tree so the
        // top nav and every subprocess (including autonomous-start) agree on
        // Pro state. Inherited by spawned children automatically.
        AIGON_FORCE_PRO: 'true',
        // Scrub git config and supply author identity — see GIT_SAFE_ENV above.
        ...GIT_SAFE_ENV,
    };

    const dashProc = spawn(process.execPath, [CLI_PATH, 'server', 'start'], {
        env: dashEnv,
        cwd: tmpDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    dashProc.stdout.on('data', (d) => {
        if (process.env.AIGON_E2E_VERBOSE) process.stdout.write('[dashboard] ' + d.toString());
    });
    dashProc.stderr.on('data', (d) => {
        if (process.env.AIGON_E2E_VERBOSE) process.stderr.write('[dashboard] ' + d.toString());
    });

    await waitForServer(`http://127.0.0.1:${PORT}`);

    // ── Write context for tests and teardown ───────────────────────────────────
    fs.writeFileSync(CTX_FILE, JSON.stringify({
        tmpDir,
        tempHome,
        worktreeBase,
        port: PORT,
        dashPid: dashProc.pid,
    }, null, 2));

    console.log(`[e2e] Dashboard ready at http://127.0.0.1:${PORT}`);
    console.log(`[e2e] Fixture: ${tmpDir}`);
};
