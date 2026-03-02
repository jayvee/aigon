#!/usr/bin/env node
/**
 * Unit tests for cross-provider eval bias detection (Feature 20).
 *
 * Runs with: node aigon-cli.test.js
 * Or: npm test
 */

'use strict';

const assert = require('assert');

// ---------------------------------------------------------------------------
// Re-implement the units under test in isolation so the test file doesn't
// need to load the full CLI (which has side-effects like reading configs).
// ---------------------------------------------------------------------------

const PROVIDER_FAMILIES = {
    cc: 'anthropic',
    cu: 'varies',
    gg: 'google',
    cx: 'openai',
};

function isSameProviderFamily(agentA, agentB) {
    const familyA = PROVIDER_FAMILIES[agentA];
    const familyB = PROVIDER_FAMILIES[agentB];
    if (!familyA || !familyB) return false;
    if (familyA === 'varies' || familyB === 'varies') return false;
    return familyA === familyB;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

console.log('\nProvider Family Map');
test('cc maps to anthropic', () => assert.strictEqual(PROVIDER_FAMILIES.cc, 'anthropic'));
test('gg maps to google',    () => assert.strictEqual(PROVIDER_FAMILIES.gg, 'google'));
test('cx maps to openai',    () => assert.strictEqual(PROVIDER_FAMILIES.cx, 'openai'));
test('cu maps to varies',    () => assert.strictEqual(PROVIDER_FAMILIES.cu, 'varies'));

console.log('\nisSameProviderFamily — same family');
test('cc vs cc → true (anthropic/anthropic)',  () => assert.strictEqual(isSameProviderFamily('cc', 'cc'), true));
test('gg vs gg → true (google/google)',        () => assert.strictEqual(isSameProviderFamily('gg', 'gg'), true));
test('cx vs cx → true (openai/openai)',        () => assert.strictEqual(isSameProviderFamily('cx', 'cx'), true));

console.log('\nisSameProviderFamily — different family');
test('cc vs gg → false (anthropic/google)',    () => assert.strictEqual(isSameProviderFamily('cc', 'gg'), false));
test('cc vs cx → false (anthropic/openai)',    () => assert.strictEqual(isSameProviderFamily('cc', 'cx'), false));
test('gg vs cx → false (google/openai)',       () => assert.strictEqual(isSameProviderFamily('gg', 'cx'), false));
test('cx vs gg → false (openai/google)',       () => assert.strictEqual(isSameProviderFamily('cx', 'gg'), false));

console.log('\nisSameProviderFamily — varies (Cursor) never triggers');
test('cu vs cc → false (varies never matches)',  () => assert.strictEqual(isSameProviderFamily('cu', 'cc'), false));
test('cc vs cu → false (varies never matches)',  () => assert.strictEqual(isSameProviderFamily('cc', 'cu'), false));
test('cu vs cu → false (varies vs varies)',      () => assert.strictEqual(isSameProviderFamily('cu', 'cu'), false));

console.log('\nisSameProviderFamily — unknown agents');
test('unknown vs cc → false',   () => assert.strictEqual(isSameProviderFamily('xx', 'cc'), false));
test('cc vs unknown → false',   () => assert.strictEqual(isSameProviderFamily('cc', 'zz'), false));
test('unknown vs unknown → false', () => assert.strictEqual(isSameProviderFamily('aa', 'bb'), false));

console.log('');
if (failed === 0) {
    console.log(`All ${passed} tests passed.\n`);
    process.exit(0);
} else {
    console.error(`${failed} test(s) failed (${passed} passed).\n`);
    process.exit(1);
}
