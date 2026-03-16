// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: path.join(__dirname),
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4109',
    headless: true,
  },
  webServer: {
    command: 'node ' + path.join(__dirname, 'server.js'),
    url: 'http://127.0.0.1:4109',
    reuseExistingServer: false,
    timeout: 10000,
  },
  reporter: [['list']],
});
