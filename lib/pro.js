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

module.exports = {
    isProAvailable,
    getPro: () => pro,
};
