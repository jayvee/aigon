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
        env: { ...process.env, HOME: os.tmpdir() },
        encoding: 'utf8',
        stdio: 'pipe',
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.status };
}

function runGit(args, cwd) {
    spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
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

    const worktreeBase = tmpDir + '-worktrees';

    // ── Create temp home with .aigon/config.json ───────────────────────────────
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-home-'));
    const aigonDir = path.join(tempHome, '.aigon');
    fs.mkdirSync(aigonDir, { recursive: true });
    fs.writeFileSync(
        path.join(aigonDir, 'config.json'),
        JSON.stringify({ repos: [tmpDir] }, null, 2)
    );

    // ── Start real dashboard server ────────────────────────────────────────────
    const dashEnv = {
        ...process.env,
        HOME: tempHome,
        PORT: String(PORT),
        // mock-bin/tmux prevents real tmux sessions from being created
        PATH: MOCK_BIN_DIR + path.delimiter + process.env.PATH,
        // GEMINI_CLI=1 makes feature-eval run in eval-setup mode (no agent launch)
        GEMINI_CLI: '1',
    };

    const dashProc = spawn(process.execPath, [CLI_PATH, 'dashboard'], {
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
