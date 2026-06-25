// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');
const { PORT } = require('./fixture-port');

// Mock-only dashboard E2E (F594). Invoked by npm run test:browser / test:ui / test:deploy.
// Live-agent smoke is opt-in only: AIGON_E2E_REAL=1 npm run test:browser:live
// (playwright.live.config.js). Never set AIGON_E2E_REAL=1 for this config.

// Compress supervisor sweep interval for failure-modes idle-state tests.
process.env.AIGON_SUPERVISOR_SWEEP_MS = process.env.AIGON_SUPERVISOR_SWEEP_MS || '2000';
// Fixture dashboard uses an isolated AIGON_HOME (set in setup.js globalSetup).
// Never rewrite or kill the operator's ~/.aigon/dashboard-runtime.json.

module.exports = defineConfig({
    testDir: path.join(__dirname),
    // Lifecycle tests can take up to 2 minutes (MockAgent delays + poll cycles)
    timeout: 120000,
    retries: 0,
    // Serial execution: tests share a single fixture and dashboard instance
    workers: 1,
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        headless: true,
        actionTimeout: 15000,
        screenshot: 'only-on-failure',
    },
    globalSetup: path.join(__dirname, 'setup.js'),
    globalTeardown: path.join(__dirname, 'teardown.js'),
    reporter: [['list']],
});
