'use strict';

// Leaf PATH probe — no lib/ imports (breaks agent-availability → security → config cycle).

const { execSync } = require('child_process');

/**
 * Check if a binary is available on PATH.
 * @param {string} binary
 * @returns {boolean}
 */
function isBinaryAvailable(binary) {
    try {
        execSync(`command -v ${binary}`, { encoding: 'utf8', stdio: 'pipe' });
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    isBinaryAvailable,
};
