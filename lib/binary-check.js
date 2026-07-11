'use strict';

// Leaf PATH probe — no lib/ imports (breaks agent-availability → security → config cycle).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function expandHome(filePath) {
    const value = String(filePath || '');
    if (!value.startsWith('~')) return value;
    return path.join(os.homedir(), value.slice(1));
}

function isExecutableFile(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Check if a binary is available on PATH.
 * @param {string} binary
 * @returns {boolean}
 */
function isBinaryAvailable(binary) {
    return !!resolveBinary(binary);
}

/**
 * Resolve a CLI binary: PATH first, then optional explicit candidate paths.
 * @param {string} binary
 * @param {{ candidates?: string[] }} [options]
 * @returns {string|null} absolute or PATH-resolved command
 */
function resolveBinary(binary, options = {}) {
    const name = String(binary || '').trim();
    if (!name) return null;
    try {
        const resolved = execSync(`command -v ${name}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
        if (resolved) return resolved;
    } catch (_) { /* fall through to candidates */ }
    const candidates = Array.isArray(options.candidates) ? options.candidates : [];
    for (const raw of candidates) {
        const candidate = expandHome(raw);
        if (isExecutableFile(candidate)) return candidate;
    }
    return null;
}

module.exports = {
    isBinaryAvailable,
    resolveBinary,
};
