#!/usr/bin/env node
'use strict';

// Validates that `npm pack` would only include explicitly allowlisted files.
// Runs automatically via the `prepublishOnly` lifecycle hook.
// Fail fast: exits non-zero if any unrecognised path is found.

const { execSync } = require('child_process');

// npm always includes these regardless of the "files" field
const ALWAYS_INCLUDED = new Set([
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
]);

// Path prefixes that are explicitly allowed via the "files" field
const ALLOWED_PREFIXES = [
    'aigon-cli.js',
    'lib/',
    'templates/',
    'assets/icon/',
];

function isAllowed(filePath) {
    if (ALWAYS_INCLUDED.has(filePath)) return true;
    return ALLOWED_PREFIXES.some(p => filePath === p || filePath.startsWith(p));
}

let raw;
try {
    raw = execSync('npm pack --dry-run --json 2>/dev/null', { encoding: 'utf8' });
} catch (err) {
    process.stderr.write(`check-pack: npm pack --dry-run failed: ${err.message}\n`);
    process.exit(1);
}

let data;
try {
    data = JSON.parse(raw);
} catch (err) {
    process.stderr.write(`check-pack: could not parse pack output: ${err.message}\n`);
    process.exit(1);
}

const files = (data[0] && data[0].files) || [];
const rejected = files.filter(f => !isAllowed(f.path));

if (rejected.length > 0) {
    process.stderr.write(`\ncheck-pack: ${rejected.length} unallowlisted file(s) would be published:\n`);
    rejected.forEach(f => process.stderr.write(`  ${f.path}\n`));
    process.stderr.write('\nFix: update "files" in package.json or add to ALLOWED_PREFIXES in scripts/check-pack.js\n\n');
    process.exit(1);
}

console.log(`check-pack: OK — ${files.length} file(s), all allowlisted`);
