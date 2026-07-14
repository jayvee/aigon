// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'dashboard-state-gallery.spec.js',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3700',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/start-dashboard-gallery.js',
    cwd: path.resolve(__dirname, '../..'),
    url: 'http://127.0.0.1:3700/api/card-gallery',
    reuseExistingServer: true,
    timeout: 15000,
  },
  reporter: [['list']],
});
