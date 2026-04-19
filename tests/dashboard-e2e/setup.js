// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { GIT_SAFE_ENV } = require('../_helpers');

const ROOT = path.join(__dirname, '..', '..');
const CLI_PATH = path.join(ROOT, 'aigon-cli.js');
const FIXTURES_DIR = path.join(os.homedir(), 'src');
const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');
const PORT = 4119;
exports.CTX_FILE = CTX_FILE;
exports.PORT = PORT;

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
    }
}

function ensureFixtures() {
    if (fs.existsSync(path.join(FIXTURES_DIR, 'brewboard'))) return;
    console.log('[e2e-setup] Fixtures missing — generating...');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-fixture.js')], { encoding: 'utf8', stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Fixture generation failed');
}

function runAigon(args, cwd) {
    return spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd, env: { ...process.env, HOME: os.tmpdir(), ...GIT_SAFE_ENV }, encoding: 'utf8', stdio: 'pipe',
    });
}

function runGit(args, cwd) {
    spawnSync('git', args, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, encoding: 'utf8', stdio: 'pipe' });
}

function waitForServer(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => {
            http.get(url, (res) => { res.resume(); resolve(); })
                .on('error', () => {
                    if (Date.now() > deadline) reject(new Error(`Server at ${url} did not start within ${timeoutMs}ms`));
                    else setTimeout(attempt, 300);
                });
        };
        attempt();
    });
}

module.exports = async function globalSetup() {
    ensureFixtures();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-dashboard-'));
    copyDir(path.join(FIXTURES_DIR, 'brewboard'), tmpDir);
    runGit(['config', 'user.email', 'test@aigon.test'], tmpDir);
    runGit(['config', 'user.name', 'Aigon Test'], tmpDir);

    // Pre-create features in inbox (IDs assigned later via dashboard Prioritise).
    runAigon(['feature-create', 'e2e-solo-feature'], tmpDir);
    runAigon(['feature-create', 'e2e-fleet-feature'], tmpDir);
    runAigon(['feature-create', 'e2e-drive-feature'], tmpDir);

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-home-'));
    const aigonDir = path.join(tempHome, '.aigon');
    fs.mkdirSync(aigonDir, { recursive: true });
    // Worktrees land under ~/.aigon/worktrees/{repoName}/ — HOME=tempHome below,
    // so worktreeBase follows HOME.
    const worktreeBase = path.join(tempHome, '.aigon', 'worktrees', path.basename(tmpDir));
    fs.writeFileSync(path.join(aigonDir, 'config.json'), JSON.stringify({ repos: [tmpDir] }, null, 2));

    const dashEnv = {
        ...process.env, HOME: tempHome, PORT: String(PORT),
        // AIGON_TEST_MODE skips terminal.app launch; tmux still runs in background.
        // GEMINI_CLI=1 makes feature-eval run in eval-setup mode (no agent launch).
        // AIGON_FORCE_PRO=true ensures the process tree agrees on Pro availability.
        AIGON_TEST_MODE: '1', GEMINI_CLI: '1', AIGON_FORCE_PRO: 'true',
        ...GIT_SAFE_ENV,
    };

    const dashProc = spawn(process.execPath, [CLI_PATH, 'server', 'start'], {
        env: dashEnv, cwd: tmpDir, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
    });
    dashProc.stdout.on('data', (d) => process.env.AIGON_E2E_VERBOSE && process.stdout.write('[dashboard] ' + d));
    dashProc.stderr.on('data', (d) => process.env.AIGON_E2E_VERBOSE && process.stderr.write('[dashboard] ' + d));

    await waitForServer(`http://127.0.0.1:${PORT}`);

    fs.writeFileSync(CTX_FILE, JSON.stringify({
        tmpDir, tempHome, worktreeBase, port: PORT, dashPid: dashProc.pid,
    }, null, 2));

    console.log(`[e2e] Dashboard ready at http://127.0.0.1:${PORT}`);
    console.log(`[e2e] Fixture: ${tmpDir}`);
};
