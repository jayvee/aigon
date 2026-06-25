// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');
const { PORT } = require('./fixture-port');
const { LIVE_AGENT_GATE } = require('./e2e-env');

if (process.env[LIVE_AGENT_GATE] !== '1') {
    throw new Error(
        `${LIVE_AGENT_GATE}=1 is required for the live-agent smoke config. `
        + 'Run: AIGON_E2E_REAL=1 npm run test:browser:live',
    );
}

module.exports = defineConfig({
    testDir: path.join(__dirname),
    testMatch: 'live-agent-smoke.spec.js',
    timeout: 60000,
    retries: 0,
    workers: 1,
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        headless: true,
        actionTimeout: 15000,
        screenshot: 'only-on-failure',
    },
    globalSetup: path.join(__dirname, 'setup-live.js'),
    globalTeardown: path.join(__dirname, 'teardown.js'),
    reporter: [['list']],
});
