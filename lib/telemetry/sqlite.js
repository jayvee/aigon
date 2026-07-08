'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

function sqlEscape(s) {
    return String(s).replace(/'/g, "''");
}

function querySqliteDb(dbPath, sql, options = {}) {
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    try {
        const result = spawnSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
            encoding: 'utf8',
            maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
            timeout: options.timeout || 15000,
        });
        if (result.status !== 0) return null;
        const out = (result.stdout || '').trim();
        if (!out) return [];
        return JSON.parse(out);
    } catch (_) {
        return null;
    }
}

module.exports = { sqlEscape, querySqliteDb };
