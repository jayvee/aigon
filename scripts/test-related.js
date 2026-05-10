#!/usr/bin/env node
'use strict';

// Usage: node scripts/test-related.js <source-file> [<source-file> ...]
// Finds and runs integration/workflow tests whose names overlap with keywords
// extracted from the given source file paths. Mirrors the keyword-matching
// logic in lib/test-loop/scoped.js (the same logic drives test:iterate).
//
// Example: node scripts/test-related.js lib/nudge.js lib/agent-status.js

const path = require('path');
const { spawnSync } = require('child_process');
const { matchTestsForKeywords, extractKeywords } = require('../lib/test-loop/scoped');

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('Usage: node scripts/test-related.js <file> [<file> ...]');
    process.exit(1);
}

const keywords = extractKeywords(files);
if (keywords.length === 0) {
    console.log('No keywords extracted from the given paths — nothing to run.');
    process.exit(0);
}

console.log(`Keywords: ${keywords.join(', ')}`);
const matched = matchTestsForKeywords(keywords);
if (matched.length === 0) {
    console.log('No related test files found.');
    process.exit(0);
}

const runner = path.join(__dirname, 'run-tests-parallel.js');
const result = spawnSync(process.execPath, [runner, ...matched], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
});
process.exit(result.status ?? 1);
