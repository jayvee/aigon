#!/usr/bin/env node
'use strict';

/**
 * Tests for lib/security.js
 * Run: node lib/security.test.js
 */

const assert = require('assert');
const { execSync } = require('child_process');

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

// --- Module exports ---
console.log('# security.js — exports');

const security = require('./security');

test('exports runSecurityScan function', () => {
    assert.strictEqual(typeof security.runSecurityScan, 'function');
});

test('exports isBinaryAvailable function', () => {
    assert.strictEqual(typeof security.isBinaryAvailable, 'function');
});

// --- isBinaryAvailable ---
console.log('\n# isBinaryAvailable');

test('finds node binary', () => {
    assert.strictEqual(security.isBinaryAvailable('node'), true);
});

test('does not find nonexistent binary', () => {
    assert.strictEqual(security.isBinaryAvailable('aigon_nonexistent_binary_xyz'), false);
});

// --- runSecurityScan with no scanners configured ---
console.log('\n# runSecurityScan — no-op cases');

test('returns passed for unknown stage', () => {
    const result = security.runSecurityScan('unknownStage');
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.skipped, true);
});

// --- Config schema ---
console.log('\n# config.js — security config schema');

const config = require('./config');

test('DEFAULT_SECURITY_CONFIG has mergeGateStages', () => {
    const sec = config.DEFAULT_SECURITY_CONFIG;
    assert.ok(sec.mergeGateStages, 'missing mergeGateStages');
    assert.ok(Array.isArray(sec.mergeGateStages.featureClose), 'featureClose should be array');
    assert.ok(Array.isArray(sec.mergeGateStages.featureSubmit), 'featureSubmit should be array');
    assert.ok(Array.isArray(sec.mergeGateStages.researchClose), 'researchClose should be array');
});

test('DEFAULT_SECURITY_CONFIG has scannerDefs with gitleaks', () => {
    const sec = config.DEFAULT_SECURITY_CONFIG;
    assert.ok(sec.scannerDefs, 'missing scannerDefs');
    assert.ok(sec.scannerDefs.gitleaks, 'missing gitleaks scanner');
    assert.ok(sec.scannerDefs.gitleaks.command, 'gitleaks scanner needs command');
    assert.ok(sec.scannerDefs.gitleaks.command.includes('gitleaks'), 'command should reference gitleaks');
    assert.ok(sec.scannerDefs.gitleaks.command.includes('{{defaultBranch}}'), 'command should have branch placeholder');
});

test('DEFAULT_SECURITY_CONFIG mode defaults to enforce', () => {
    assert.strictEqual(config.DEFAULT_SECURITY_CONFIG.mode, 'enforce');
});

// --- mergeSecurityConfig ---
console.log('\n# mergeSecurityConfig — deep merge');

test('mergeSecurityConfig deep-merges mergeGateStages', () => {
    const base = { mergeGateStages: { featureClose: ['gitleaks'] } };
    const overrides = { mergeGateStages: { featureClose: ['custom-scanner'], newStage: ['scanner-x'] } };
    const result = config.mergeSecurityConfig(base, overrides);
    // overrides win for featureClose
    assert.deepStrictEqual(result.mergeGateStages.featureClose, ['custom-scanner']);
    // new stage preserved
    assert.deepStrictEqual(result.mergeGateStages.newStage, ['scanner-x']);
    // defaults preserved for unmentioned stages
    assert.deepStrictEqual(result.mergeGateStages.featureSubmit, ['gitleaks']);
});

test('mergeSecurityConfig deep-merges scannerDefs', () => {
    const base = {};
    const overrides = {
        scannerDefs: {
            custom: { command: 'my-scanner --check' },
        },
    };
    const result = config.mergeSecurityConfig(base, overrides);
    // custom scanner added
    assert.ok(result.scannerDefs.custom, 'custom scanner should be present');
    assert.strictEqual(result.scannerDefs.custom.command, 'my-scanner --check');
    // default gitleaks preserved
    assert.ok(result.scannerDefs.gitleaks, 'gitleaks should still be present');
});

test('mergeSecurityConfig overrides mode', () => {
    const result = config.mergeSecurityConfig({}, { mode: 'warn' });
    assert.strictEqual(result.mode, 'warn');
});

test('mergeSecurityConfig overrides enabled to false', () => {
    const result = config.mergeSecurityConfig({}, { enabled: false });
    assert.strictEqual(result.enabled, false);
});

// --- getEffectiveConfig includes security ---
console.log('\n# getEffectiveConfig — security section');

test('getEffectiveConfig returns security with mergeGateStages', () => {
    const cfg = config.getEffectiveConfig();
    assert.ok(cfg.security, 'security missing from effective config');
    assert.ok(cfg.security.mergeGateStages, 'mergeGateStages missing');
    assert.ok(cfg.security.scannerDefs, 'scannerDefs missing');
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
