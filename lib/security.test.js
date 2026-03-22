#!/usr/bin/env node
'use strict';

/**
 * Tests for lib/security.js
 * Run: node lib/security.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

test('exports listChangedPaths function', () => {
    assert.strictEqual(typeof security.listChangedPaths, 'function');
});

test('exports createScanSnapshot function', () => {
    assert.strictEqual(typeof security.createScanSnapshot, 'function');
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

function withTempRepo(fn) {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-security-test-'));
    try {
        execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
        execSync('git config user.name "Aigon Test"', { cwd: repoDir, stdio: 'pipe' });
        execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'pipe' });
        fn(repoDir);
    } finally {
        fs.rmSync(repoDir, { recursive: true, force: true });
    }
}

console.log('\n# snapshot helpers');

test('listChangedPaths includes committed branch diff and staged files', () => {
    withTempRepo((repoDir) => {
        fs.writeFileSync(path.join(repoDir, 'base.txt'), 'base\n');
        execSync('git add base.txt && git commit -m "base"', { cwd: repoDir, stdio: 'pipe' });
        execSync('git checkout -b feature-120-test', { cwd: repoDir, stdio: 'pipe' });

        fs.writeFileSync(path.join(repoDir, 'committed.txt'), 'committed\n');
        execSync('git add committed.txt && git commit -m "committed"', { cwd: repoDir, stdio: 'pipe' });

        fs.writeFileSync(path.join(repoDir, 'staged.txt'), 'staged\n');
        execSync('git add staged.txt', { cwd: repoDir, stdio: 'pipe' });

        const paths = security.listChangedPaths('main', { cwd: repoDir }).sort();
        assert.deepStrictEqual(paths, ['committed.txt', 'staged.txt']);
    });
});

test('createScanSnapshot uses HEAD for committed files and index for staged files', () => {
    withTempRepo((repoDir) => {
        fs.writeFileSync(path.join(repoDir, 'base.txt'), 'base\n');
        execSync('git add base.txt && git commit -m "base"', { cwd: repoDir, stdio: 'pipe' });
        execSync('git checkout -b feature-120-test', { cwd: repoDir, stdio: 'pipe' });

        fs.writeFileSync(path.join(repoDir, 'committed.txt'), 'head-version\n');
        execSync('git add committed.txt && git commit -m "committed"', { cwd: repoDir, stdio: 'pipe' });
        fs.writeFileSync(path.join(repoDir, 'committed.txt'), 'worktree-only\n');

        fs.writeFileSync(path.join(repoDir, 'staged.txt'), 'staged-version\n');
        execSync('git add staged.txt', { cwd: repoDir, stdio: 'pipe' });
        fs.writeFileSync(path.join(repoDir, 'staged.txt'), 'unstaged-version\n');

        const snapshot = security.createScanSnapshot('main', { cwd: repoDir });
        try {
            const committed = fs.readFileSync(path.join(snapshot.scanPath, 'committed.txt'), 'utf8');
            const staged = fs.readFileSync(path.join(snapshot.scanPath, 'staged.txt'), 'utf8');
            assert.strictEqual(committed, 'head-version\n');
            assert.strictEqual(staged, 'staged-version\n');
        } finally {
            snapshot.cleanup();
        }
    });
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
    assert.ok(sec.scannerDefs.gitleaks.command.includes('{{scanPath}}'), 'command should have scan path placeholder');
    assert.ok(sec.scannerDefs.gitleaks.command.includes('--no-git'), 'command should scan snapshot content');
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

test('mergeSecurityConfig preserves scanner command when adding gitleaks commitCommand', () => {
    const result = config.mergeSecurityConfig({}, {
        scannerDefs: {
            gitleaks: { commitCommand: 'gitleaks git --no-banner --log-opts="-1"' },
        },
    });
    assert.ok(result.scannerDefs.gitleaks.command, 'merge-gate command should be preserved');
    assert.strictEqual(
        result.scannerDefs.gitleaks.commitCommand,
        'gitleaks git --no-banner --log-opts="-1"'
    );
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

// --- CC template PostCommit hook ---
console.log('\n# cc.json — PostCommit hook configuration');

test('cc.json template has PostCommit hook with security-scan-commit', () => {
    const ccTemplate = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'templates', 'agents', 'cc.json'), 'utf8'
    ));
    const hooks = ccTemplate.extras.settings.hooks;
    assert.ok(hooks.PostCommit, 'PostCommit hook missing from cc.json');
    assert.ok(Array.isArray(hooks.PostCommit), 'PostCommit should be an array');
    const postCommitHooks = hooks.PostCommit[0].hooks;
    assert.ok(postCommitHooks.some(h => h.command.includes('security-scan-commit')),
        'PostCommit should include security-scan-commit command');
});

test('PostCommit hook runs outside git mechanism (not in .githooks)', () => {
    // Verify that PostCommit is configured as a Claude Code hook, not a git hook
    const ccTemplate = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'templates', 'agents', 'cc.json'), 'utf8'
    ));
    const hooks = ccTemplate.extras.settings.hooks;
    assert.ok(hooks.PostCommit, 'PostCommit should be in Claude Code settings hooks');
    // The .githooks/pre-commit is a git hook; PostCommit in settings.json is a CC hook
    const preCommitPath = path.join(__dirname, '..', '.githooks', 'pre-commit');
    if (fs.existsSync(preCommitPath)) {
        const preCommitContent = fs.readFileSync(preCommitPath, 'utf8');
        assert.ok(!preCommitContent.includes('security-scan-commit'),
            'security-scan-commit should NOT be in git hooks (must be bypass-resistant)');
    }
});

// --- security-scan-commit command ---
console.log('\n# misc.js — security-scan-commit command');

test('security-scan-commit command is registered in misc commands', () => {
    const { createMiscCommands } = require('./commands/misc');
    const cmds = createMiscCommands();
    assert.ok(typeof cmds['security-scan-commit'] === 'function',
        'security-scan-commit should be a registered command');
});

// --- doctor GitHub secret scanning check ---
console.log('\n# setup.js — doctor GitHub checks');

test('isBinaryAvailable is usable for gh check', () => {
    // The doctor check uses isBinaryAvailable('gh') — just verify the function works
    const result = security.isBinaryAvailable('gh');
    assert.strictEqual(typeof result, 'boolean', 'isBinaryAvailable should return boolean');
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
