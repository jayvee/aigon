'use strict';

/**
 * Error handling utilities for Aigon.
 *
 * Provides structured error handling to replace silent catch blocks
 * with meaningful warnings while keeping genuine probe operations silent.
 */

/**
 * Execute fn and return its result; on error, return defaultValue.
 * Optionally warn to stderr when an error is caught.
 *
 * @param {Function} fn - Function to execute
 * @param {*} defaultValue - Value to return on error
 * @param {Object} [opts]
 * @param {boolean} [opts.warn=false] - Whether to log a warning on error
 * @param {string} [opts.context=''] - Context label for the warning message
 * @returns {*} Result of fn, or defaultValue on error
 */
function tryOrDefault(fn, defaultValue, { warn = false, context = '' } = {}) {
    try {
        return fn();
    } catch (e) {
        if (warn) {
            const label = context ? `[${context}]` : '[aigon]';
            process.stderr.write(`${label} Warning: ${e.message}\n`);
        }
        return defaultValue;
    }
}

/**
 * Classify an error by its type.
 *
 * @param {Error} e - Error to classify
 * @returns {'missing'|'permission'|'parse'|'unknown'} Error category
 */
function classifyError(e) {
    if (e.code === 'ENOENT') return 'missing';       // File doesn't exist — expected
    if (e.code === 'EACCES') return 'permission';    // Permission denied — bug
    if (e instanceof SyntaxError) return 'parse';    // JSON/YAML parse — corruption
    return 'unknown';
}

module.exports = { tryOrDefault, classifyError };
