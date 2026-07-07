// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { PORT } = require('./fixture-port');
const {
    isLiveAgentRun,
    buildMockOnlyDashEnv,
    buildLiveAgentDashEnv,
    assertLiveAgentPrerequisites,
} = require('./e2e-env');
const {
    provisionEphemeralSeededInstance,
    seedE2eFeatures,
} = require('../../lib/ephemeral-seeded-instance');

const ROOT = path.join(__dirname, '..', '..');
const CLI_PATH = path.join(ROOT, 'aigon-cli.js');
const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');

exports.CTX_FILE = CTX_FILE;
exports.PORT = PORT;

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

    const sandbox = provisionEphemeralSeededInstance({
        fixture: 'brewboard',
        cliPath: CLI_PATH,
        repoPrefix: 'aigon-e2e-dashboard-',
        homePrefix: 'aigon-e2e-home-',
    });
    seedE2eFeatures(sandbox.repoPath, CLI_PATH);

    const { tempHome, repoPath: tmpDir, tmuxTmpDir } = sandbox;
    const worktreeBase = path.join(tempHome, '.aigon', 'worktrees', path.basename(tmpDir));

    const dashEnv = live
        ? buildLiveAgentDashEnv({ HOME: tempHome, AIGON_HOME: tempHome, PORT: String(PORT), TMUX_TMPDIR: tmuxTmpDir })
        : buildMockOnlyDashEnv({ HOME: tempHome, AIGON_HOME: tempHome, PORT: String(PORT), TMUX_TMPDIR: tmuxTmpDir });

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
