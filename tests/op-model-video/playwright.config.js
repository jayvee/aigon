// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
    testDir: __dirname,
    timeout: 90000,
    retries: 0,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4100',
        headless: true,
        viewport: { width: 1440, height: 900 },
        actionTimeout: 15000,
        screenshot: 'on',
        video: 'on',
        trace: 'on',
    },
    outputDir: path.join(__dirname, 'output'),
    reporter: [['list']],
});
