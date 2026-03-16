// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.DASHBOARD_URL || 'http://127.0.0.1:4203',
    video: 'on',
    screenshot: 'on',
    trace: 'on',
  },
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  outputDir: 'test-results',
});
