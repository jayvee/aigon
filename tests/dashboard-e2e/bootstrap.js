// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { GIT_SAFE_ENV } = require('../_helpers');
const { PORT } = require('./fixture-port');
const {
    isLiveAgentRun,
    buildMockOnlyDashEnv,
    buildLiveAgentDashEnv,
    assertLiveAgentPrerequisites,
} = require('./e2e-env');

const ROOT = path.join(__dirname, '..', '..');
const CLI_PATH = path.join(ROOT, 'aigon-cli.js');
const FIXTURES_DIR = path.join(os.homedir(), 'src');
const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');

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
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-fixture.js')], {
        encoding: 'utf8', stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error('Fixture generation failed');
}

function runAigon(args, cwd, { live = false } = {}) {
    const { stripLiveAgentEnv } = require('./e2e-env');
    const base = stripLiveAgentEnv({ ...process.env, HOME: os.tmpdir(), ...GIT_SAFE_ENV });
    if (!live) {
        base.AIGON_TEST_MODE = '1';
    } else {
        delete base.AIGON_TEST_MODE;
        delete base.MOCK_AGENT_BIN;
    }
    return spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd, env: base, encoding: 'utf8', stdio: 'pipe',
    });
}

function assertAigonOk(result, args) {
    if (result.status === 0) return;
    throw new Error(`aigon ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
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

const SEED_FEATURES = [
    { title: 'e2e solo feature', slug: 'e2e-solo-feature' },
    { title: 'e2e fleet feature', slug: 'e2e-fleet-feature' },
    { title: 'e2e drive feature', slug: 'e2e-drive-feature' },
    { title: 'e2e close failure feature', slug: 'e2e-close-failure-feature' },
    { title: 'e2e mark complete feature', slug: 'e2e-mark-complete-feature' },
];

/**
 * @param {{ live?: boolean }} options
 */
async function runGlobalSetup(options = {}) {
    const live = options.live === true;
    if (live) {
        assertLiveAgentPrerequisites();
    } else if (isLiveAgentRun()) {
        throw new Error(
            'AIGON_E2E_REAL=1 is opt-in only — use `AIGON_E2E_REAL=1 npm run test:browser:live` '
            + '(playwright.live.config.js). The default test:browser / test:ui suite is mock-only.',
        );
    }

    ensureFixtures();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-dashboard-'));
    copyDir(path.join(FIXTURES_DIR, 'brewboard'), tmpDir);
    runGit(['config', 'user.email', 'test@aigon.test'], tmpDir);
    runGit(['config', 'user.name', 'Aigon Test'], tmpDir);

    const fixtureInbox = path.join(tmpDir, 'docs', 'specs', 'features', '01-inbox');
    if (fs.existsSync(fixtureInbox)) {
        for (const f of fs.readdirSync(fixtureInbox)) {
            fs.rmSync(path.join(fixtureInbox, f), { force: true });
        }
    }

    for (const { title, slug } of SEED_FEATURES) {
        assertAigonOk(runAigon(['feature-create', title], tmpDir, { live }), ['feature-create', title]);
        assertAigonOk(runAigon(['feature-prioritise', slug], tmpDir, { live }), ['feature-prioritise', slug]);
    }

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-home-'));
    const aigonDir = path.join(tempHome, '.aigon');
    fs.mkdirSync(aigonDir, { recursive: true });
    const tmuxTmpDir = path.join(tempHome, '.tmux');
    fs.mkdirSync(tmuxTmpDir, { recursive: true, mode: 0o700 });
    const worktreeBase = path.join(tempHome, '.aigon', 'worktrees', path.basename(tmpDir));
    fs.writeFileSync(path.join(aigonDir, 'config.json'), JSON.stringify({ repos: [tmpDir] }, null, 2));

    const dashEnv = live
        ? buildLiveAgentDashEnv({ HOME: tempHome, AIGON_HOME: tempHome, PORT: String(PORT), TMUX_TMPDIR: tmuxTmpDir, ...GIT_SAFE_ENV })
        : buildMockOnlyDashEnv({ HOME: tempHome, AIGON_HOME: tempHome, PORT: String(PORT), TMUX_TMPDIR: tmuxTmpDir, ...GIT_SAFE_ENV });

    const dashProc = spawn(process.execPath, [CLI_PATH, 'server', 'start'], {
        env: dashEnv, cwd: tmpDir, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
    });
    dashProc.stdout.on('data', (d) => process.stdout.write('[dashboard] ' + d));
    dashProc.stderr.on('data', (d) => process.stderr.write('[dashboard] ' + d));
    await waitForServer(`http://127.0.0.1:${PORT}`);
    fs.writeFileSync(CTX_FILE, JSON.stringify({
        tmpDir, tempHome, worktreeBase, tmuxTmpDir, port: PORT, dashPid: dashProc.pid, live,
    }, null, 2));
    console.log(`[e2e] Dashboard ready at http://127.0.0.1:${PORT} (${live ? 'live-agent' : 'mock-only'})`);
    console.log(`[e2e] Fixture: ${tmpDir}`);
}

module.exports = { runGlobalSetup };
