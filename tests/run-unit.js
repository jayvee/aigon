#!/usr/bin/env node
/**
 * Unit test runner — Layer 1 of the test pyramid.
 *
 * Runs all tests/unit/*.test.js files sequentially.
 * Exit code is non-zero if any test file fails.
 */

'use strict';

const { execFileSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

const unitDir = path.join(__dirname, 'unit');
const testFiles = readdirSync(unitDir)
    .filter(f => f.endsWith('.test.js'))
    .sort();

let passed = 0;
let failed = 0;

for (const file of testFiles) {
    const filePath = path.join(unitDir, file);
    try {
        execFileSync(process.execPath, [filePath], { stdio: 'inherit' });
        passed++;
    } catch (err) {
        failed++;
    }
}

console.log(`\n═══ Unit tests: ${passed + failed} suites, ${passed} passed, ${failed} failed ═══`);
if (failed > 0) process.exit(1);
