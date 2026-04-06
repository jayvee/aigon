'use strict';

let pro = null;
try { pro = require('@aigon/pro'); } catch { /* free tier — @aigon/pro not installed */ }

/**
 * Check if Pro is available, respecting the forcePro config override.
 * - forcePro === false → simulate free tier even when @aigon/pro is installed
 * - forcePro === true  → no effect (Pro still requires the package to be installed)
 * Config is read lazily to avoid circular require with lib/config.js.
 */
function isProAvailable() {
    try {
        const { loadProjectConfig } = require('./config');
        const cfg = loadProjectConfig();
        if (cfg.forcePro === false) return false;
    } catch { /* config not available — ignore */ }
    return !!pro;
}

/**
 * Check a Pro capability and print a one-shot fallback message if unavailable.
 * Returns boolean. Never throws. Never calls process.exit — callers decide.
 */
function assertProCapability(capabilityName, fallbackCmd) {
    if (isProAvailable()) return true;
    console.log(`🔒 ${capabilityName} is a Pro feature.`);
    if (fallbackCmd) console.log(`   Free alternative: ${fallbackCmd}`);
    console.log('   Learn more: https://aigon.build/pro');
    return false;
}

module.exports = {
    isProAvailable,
    getPro: () => pro,
    assertProCapability,
};
