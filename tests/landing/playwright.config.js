// @ts-check
const path = require('path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /home-carousel\.spec\.js$/,
  timeout: 30000,
  use: {
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
  },
  reporter: [['list']],
  outputDir: path.join(__dirname, '../../test-results'),
});
