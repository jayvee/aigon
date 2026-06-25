// @ts-check
'use strict';

/**
 * Playwright globalSetup for the opt-in live-agent smoke path only.
 * Invoked via playwright.live.config.js — never by test:browser / test:ui.
 */

const { runGlobalSetup } = require('./bootstrap');

module.exports = async function globalSetup() {
    await runGlobalSetup({ live: true });
};
