#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const {
    validateSeedProvisionCommits,
    PROVISION_COMMIT_ALLOWLIST,
} = require('../../lib/commands/setup/seed-reset');

// Build a fake execFn that returns canned `git log --format="%H %s"` output.
function fakeExec(output) {
    return () => output;
}

function fakeExecThrows(message) {
    return () => { throw new Error(message); };
}

test('ok when seedTipAtClone..HEAD is empty (no provision commits added)', () => {
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: 'abc123',
        execFn: fakeExec(''),
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.rogue, []);
    assert.strictEqual(result.totalNew, 0);
});

test('ok with only "chore: install Aigon v..." provision commits', () => {
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: 'abc123',
        execFn: fakeExec([
            'deadbeef1 chore: install Aigon v2.66.0-beta.2',
            'deadbeef2 chore: install Aigon v2.66.0-beta.2',
        ].join('\n')),
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.rogue, []);
    assert.strictEqual(result.totalNew, 2);
});

test('ok with "chore: strip stale seed config" alongside install commit', () => {
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: 'abc123',
        execFn: fakeExec([
            'aaaa1111 chore: install Aigon v2.66.0-beta.2',
            'aaaa2222 chore: strip stale seed config',
        ].join('\n')),
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.rogue, []);
});

// REGRESSION: F02 brewery-import contamination, May 2026. A "Merge feature N"
// commit on HEAD between the cloned seed tip and the push-back is exactly the
// contamination shape that turned the seed into a non-resettable demo.
test('rejects "Merge feature N" commits between seed tip and HEAD', () => {
    const rogueLine = 'df586a91 Merge feature 02 from agent cu';
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: 'abc123',
        execFn: fakeExec([
            'aaaa1111 chore: install Aigon v2.66.0-beta.2',
            rogueLine,
        ].join('\n')),
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.rogue, [rogueLine]);
    assert.strictEqual(result.totalNew, 2);
});

test('rejects raw "feat:" commits that would leak app code into the seed', () => {
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: 'abc123',
        execFn: fakeExec('dd4a2f6a feat: add brewery CSV parser with quotes and dedupe'),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.rogue.length, 1);
});

test('rejects "fix:" and other non-allowlisted prefixes', () => {
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: 'abc123',
        execFn: fakeExec([
            'bb22cc33 fix(review): restore dropped tracked files',
            'cc44dd55 chore: install Aigon v2.66.0-beta.2',
        ].join('\n')),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.rogue.length, 1);
    assert.ok(result.rogue[0].includes('fix(review)'));
});

test('returns ok=false with explanatory error when seedTipAtClone is missing', () => {
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: null,
        execFn: fakeExec(''),
    });
    assert.strictEqual(result.ok, false);
    assert.ok(/seedTipAtClone/.test(result.error || ''));
});

test('returns ok=false when git log throws (e.g. bad ref)', () => {
    const result = validateSeedProvisionCommits({
        repoPath: '/tmp/fake',
        seedTipAtClone: 'nonexistent',
        execFn: fakeExecThrows('fatal: ambiguous argument'),
    });
    assert.strictEqual(result.ok, false);
    assert.ok(/ambiguous|fatal/.test(result.error || ''));
});

test('PROVISION_COMMIT_ALLOWLIST is exported and contains the expected patterns', () => {
    assert.ok(Array.isArray(PROVISION_COMMIT_ALLOWLIST));
    assert.ok(PROVISION_COMMIT_ALLOWLIST.length >= 3);
    const sample = 'chore: install Aigon v2.66.0-beta.2';
    assert.ok(PROVISION_COMMIT_ALLOWLIST.some(re => re.test(sample)));
});

report();
