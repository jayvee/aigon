'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Infrastructure-only JSON IO helpers. No imports from workflow-core,
 * dashboard, commands, config, or agent modules — domain modules depend on
 * this; it depends only on Node stdlib.
 */

/**
 * Read and parse a JSON file. Returns `defaultValue` on any error
 * (missing file, invalid JSON, permission denied).
 */
function readJsonSafe(filePath, defaultValue = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return defaultValue;
    }
}

/**
 * Ensure a directory exists (mkdir -p). No-ops when the directory already
 * exists. Throws on unexpected OS errors.
 */
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * Serialise `value` to JSON and write it atomically via a temp file so
 * concurrent readers never see a partial write. Creates parent directories
 * as needed.
 */
function writeJsonAtomic(filePath, value) {
    const dir = path.dirname(filePath);
    ensureDir(dir);
    const tmp = filePath + '.tmp.' + process.pid;
    try {
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
        fs.renameSync(tmp, filePath);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        throw err;
    }
}

module.exports = { readJsonSafe, writeJsonAtomic, ensureDir };
