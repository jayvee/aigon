// @ts-check
'use strict';

/**
 * Playwright globalSetup for the default mock-only dashboard E2E suite.
 *
 * Safe to run on every push / in CI: forces AIGON_TEST_MODE + MOCK_AGENT_BIN and
 * strips inherited model-override env vars so feature-start cannot reach a paid agent.
 * See tests/dashboard-e2e/e2e-env.js and CONTRIBUTING.md § Dashboard E2E paths.
 */

const { runGlobalSetup } = require('./bootstrap');

module.exports = async function globalSetup() {
    await runGlobalSetup({ live: false });
};
