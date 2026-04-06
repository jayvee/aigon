// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');
const os = require('os');

const PORT = 4119;

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
        // Capture a screenshot after every test so runs are self-documenting
        // and failures are diagnosable without rerunning with --trace.
        screenshot: 'on',
    },
    globalSetup: path.join(__dirname, 'setup.js'),
    globalTeardown: path.join(__dirname, 'teardown.js'),
    reporter: [['list']],
});
