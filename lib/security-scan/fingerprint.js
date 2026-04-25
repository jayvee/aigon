'use strict';

const crypto = require('crypto');

// Strip whitespace, replace variable-like identifiers with _v_, string literals with _s_
function normalize(snippet) {
    if (!snippet) return '';
    return snippet
        .replace(/\s+/g, ' ')
        .trim()
        // Replace identifiers first so _s_ placeholder isn't re-matched
        .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]{2,}\b/g, '_v_')
        // Replace string literals (single, double, template) — identifiers inside are already normalized
        .replace(/"[^"]*"/g, '"_s_"')
        .replace(/'[^']*'/g, "'_s_'")
        .replace(/`[^`]*`/g, '`_s_`');
}

function fingerprint(category, file, lineSnippet) {
    const norm = normalize(lineSnippet);
    const input = `${category}|${file}|${norm}`;
    return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = { fingerprint, normalize };
