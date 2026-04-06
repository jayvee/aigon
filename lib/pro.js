'use strict';

let pro = null;
try { pro = require('@aigon/pro'); } catch { /* free tier — @aigon/pro not installed */ }

/**
 * Check if Pro is available, respecting the AIGON_FORCE_PRO environment override.
 *
 * Pro availability is a property of the **aigon install**, not of any individual
 * repo. The override therefore lives in an environment variable — naturally
 * global to a process tree, non-persistent, and test-friendly. It must NOT be
 * read from project config (`.aigon/config.json`); a per-repo Pro flag produced
 * the 2026-04-06 incoherence bug where the dashboard top nav (running with
 * `cwd: ~/src/aigon`) and the autonomous-start subprocess (running with
 * `cwd: ~/src/brewboard`) disagreed about Pro state in the same session.
 *
 * Accepted AIGON_FORCE_PRO values:
 *   - "false" / "0" → simulate free tier even when @aigon/pro is installed
 *   - "true"  / "1" → no effect (Pro still requires the package to be installed)
 *   - anything else / unset → no override
 */
function isProAvailable() {
    const raw = process.env.AIGON_FORCE_PRO;
    if (raw === 'false' || raw === '0') return false;
    return !!pro;
}

/**
 * Check a Pro capability and print a one-shot fallback message if unavailable.
 * Returns boolean. Never throws. Never calls process.exit — callers decide.
 *
 * Writes to stderr (not stdout) so the dashboard's error-extraction
 * heuristic in dashboard-server.js can surface the first line as the
 * user-facing error toast instead of showing a generic "exit code 1"
 * message. This also matches shell convention: failure-path output
 * belongs on stderr.
 */
function assertProCapability(capabilityName, fallbackCmd) {
    if (isProAvailable()) return true;
    console.error(`🔒 ${capabilityName} is a Pro feature — coming later.`);
    if (fallbackCmd) console.error(`   Free alternative: ${fallbackCmd}`);
    console.error('   Pro is in development and not yet available for purchase.');
    return false;
}

module.exports = {
    isProAvailable,
    getPro: () => pro,
    assertProCapability,
};
