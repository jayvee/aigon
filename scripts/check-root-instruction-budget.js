#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 24 * 1024;
const MAX_LINES = 180;
const REQUIRED_ANCHORS = [
    'aigon-root:oss-pro-boundary',
    'aigon-root:target-zero-opinion',
    'aigon-root:template-source',
    'aigon-root:lifecycle-authority',
    'aigon-root:ctx-pattern',
    'aigon-root:dashboard-gallery',
    'aigon-root:server-restart',
    'aigon-root:test-commit-version',
];

const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'AGENTS.md'));

function fail(message) {
    console.error(`✗ check-root-instruction-budget: ${message}`);
    process.exitCode = 1;
}

if (!fs.existsSync(target)) {
    fail(`missing root instruction file: ${target}`);
} else {
    const text = fs.readFileSync(target, 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    const lines = text === '' ? 0 : text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);

    if (bytes > MAX_BYTES) {
        fail(`${path.basename(target)} is ${bytes} bytes; limit is ${MAX_BYTES} bytes. Move deep reference material to docs/.`);
    }
    if (lines > MAX_LINES) {
        fail(`${path.basename(target)} is ${lines} lines; limit is ${MAX_LINES} lines. Keep only always-needed invariants and pointers.`);
    }

    const missing = REQUIRED_ANCHORS.filter((anchor) => !text.includes(`<!-- ${anchor} -->`));
    if (missing.length > 0) {
        fail(`missing required safety anchor(s): ${missing.join(', ')}. Restore the marked invariant section(s).`);
    }

    if (!process.exitCode) {
        console.log(`✓ check-root-instruction-budget: ${lines} lines, ${bytes} bytes, ${REQUIRED_ANCHORS.length} safety anchors`);
    }
}
