// @ts-check
'use strict';

/**
 * Dashboard E2E environment contract (F594).
 *
 * Default suite (`npm run test:browser` / `test:ui`): mock-only — never inherits
 * operator model overrides or launches paid agent sessions.
 *
 * Opt-in live smoke (`AIGON_E2E_REAL=1 npm run test:browser:live`): maintainer
 * path only; uses playwright.live.config.js + setup-live.js.
 */

const path = require('path');
const { spawnSync } = require('child_process');

/** Gate env var — must be exactly `1` to run the live-agent smoke path. */
const LIVE_AGENT_GATE = 'AIGON_E2E_REAL';

/** Pinned implement model for live smoke (Haiku — cheapest supported cc model). */
const LIVE_AGENT_CC_MODEL = 'claude-haiku-4-5-20251001';

const MOCK_AGENT_BIN_PATH = path.join(__dirname, '..', 'integration', 'mock-bin', 'mock-agent-bin.sh');

const MODEL_OVERRIDE_KEY = /^AIGON_(?:[A-Z0-9]+_(?:RESEARCH|IMPLEMENT|EVALUATE|REVIEW|SPEC)_MODEL|TEST_MODEL(?:_[A-Z0-9]+)?)$/;

/**
 * Remove inherited env keys that could route feature-start into a real model session.
 * @param {NodeJS.ProcessEnv} source
 * @returns {NodeJS.ProcessEnv}
 */
function stripLiveAgentEnv(source) {
    const env = { ...source };
    for (const key of Object.keys(env)) {
        if (MODEL_OVERRIDE_KEY.test(key) || key === 'MOCK_AGENT_BIN') {
            delete env[key];
        }
    }
    return env;
}

function isLiveAgentRun() {
    return process.env[LIVE_AGENT_GATE] === '1';
}

/**
 * Build the dashboard server env for the default mock-only Playwright suite.
 * @param {Record<string, string>} overrides
 * @returns {NodeJS.ProcessEnv}
 */
function buildMockOnlyDashEnv(overrides = {}) {
    const env = stripLiveAgentEnv({ ...process.env, ...overrides });
    env.AIGON_TEST_MODE = '1';
    env.AIGON_E2E_SERVER = '1';
    env.GEMINI_CLI = '1';
    env.AIGON_FORCE_PRO = 'true';
    env.MOCK_AGENT_BIN = MOCK_AGENT_BIN_PATH;
    delete env.TMUX;
    return env;
}

/**
 * Build the dashboard server env for the opt-in live-agent smoke path.
 * @param {Record<string, string>} overrides
 * @returns {NodeJS.ProcessEnv}
 */
function buildLiveAgentDashEnv(overrides = {}) {
    const env = stripLiveAgentEnv({ ...process.env, ...overrides });
    env.AIGON_E2E_SERVER = '1';
    env.AIGON_FORCE_PRO = 'true';
    env.AIGON_CC_IMPLEMENT_MODEL = LIVE_AGENT_CC_MODEL;
    delete env.AIGON_TEST_MODE;
    delete env.MOCK_AGENT_BIN;
    delete env.TMUX;
    return env;
}

/**
 * Fail closed when live-agent prerequisites are missing.
 */
function assertLiveAgentPrerequisites() {
    if (!isLiveAgentRun()) {
        throw new Error(`${LIVE_AGENT_GATE}=1 is required for the live-agent smoke path`);
    }
    if (process.env.CI === 'true' || process.env.CI === '1') {
        throw new Error(`${LIVE_AGENT_GATE} live-agent smoke is opt-in only and must not run in CI`);
    }
    const which = spawnSync('command', ['-v', 'claude'], { encoding: 'utf8', shell: true });
    if (which.status !== 0) {
        throw new Error('live-agent smoke requires `claude` on PATH (brew install claude)');
    }
    const auth = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', stdio: 'pipe' });
    const authOut = `${auth.stdout || ''}${auth.stderr || ''}`;
    if (auth.status !== 0 || !/loggedIn/i.test(authOut)) {
        throw new Error('live-agent smoke requires `claude auth status` to report loggedIn — run claude login');
    }
}

module.exports = {
    LIVE_AGENT_GATE,
    LIVE_AGENT_CC_MODEL,
    MOCK_AGENT_BIN_PATH,
    stripLiveAgentEnv,
    isLiveAgentRun,
    buildMockOnlyDashEnv,
    buildLiveAgentDashEnv,
    assertLiveAgentPrerequisites,
};
