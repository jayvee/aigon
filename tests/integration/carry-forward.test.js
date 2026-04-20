'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { buildIterationCarryForward, CARRY_FORWARD_MAX_CHARS } = require('../../lib/validation');

test('includes iteration number in carry-forward', () => {
    const result = buildIterationCarryForward({
        iteration: 2,
        commits: ['feat: implement foo'],
        filesChanged: ['lib/foo.js'],
        validationSummary: 'Test: npm test exited with code 1',
        criteriaFeedback: null
    });
    assert.match(result, /Previous attempt \(iteration 2\)/);
});

test('includes commits list', () => {
    const result = buildIterationCarryForward({
        iteration: 1,
        commits: ['feat: add auth', 'fix: typo'],
        filesChanged: [],
        validationSummary: 'Failed',
        criteriaFeedback: null
    });
    assert.match(result, /feat: add auth/);
    assert.match(result, /fix: typo/);
});

test('includes changed files', () => {
    const result = buildIterationCarryForward({
        iteration: 1,
        commits: [],
        filesChanged: ['lib/validation.js', 'lib/utils.js'],
        validationSummary: 'npm test exited with code 1',
        criteriaFeedback: null
    });
    assert.match(result, /lib\/validation\.js/);
    assert.match(result, /lib\/utils\.js/);
});

test('includes criteria feedback when present', () => {
    const result = buildIterationCarryForward({
        iteration: 3,
        commits: [],
        filesChanged: [],
        validationSummary: 'ok',
        criteriaFeedback: '  ❌ [FAIL] Token reduction must be ≥50%'
    });
    assert.match(result, /Failing criteria/);
    assert.match(result, /Token reduction/);
});

test('omits criteria feedback when null', () => {
    const result = buildIterationCarryForward({
        iteration: 1,
        commits: ['feat: x'],
        filesChanged: [],
        validationSummary: 'failed',
        criteriaFeedback: null
    });
    assert.doesNotMatch(result, /Failing criteria/);
});

test('hard-caps output at CARRY_FORWARD_MAX_CHARS', () => {
    const longCommits = Array.from({ length: 100 }, (_, i) => `feat: implement very long feature description number ${i}`);
    const longFiles = Array.from({ length: 100 }, (_, i) => `lib/very/long/path/to/file${i}.js`);
    const result = buildIterationCarryForward({
        iteration: 99,
        commits: longCommits,
        filesChanged: longFiles,
        validationSummary: 'x'.repeat(1000),
        criteriaFeedback: 'y'.repeat(1000)
    });
    assert.ok(result.length <= CARRY_FORWARD_MAX_CHARS, `Expected ≤${CARRY_FORWARD_MAX_CHARS} chars, got ${result.length}`);
});

test('handles empty/missing fields gracefully', () => {
    const result = buildIterationCarryForward({
        iteration: 2,
        commits: [],
        filesChanged: [],
        validationSummary: null,
        criteriaFeedback: null
    });
    assert.match(result, /Previous attempt \(iteration 2\)/);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
});

test('truncates long carry-forward with ellipsis', () => {
    const result = buildIterationCarryForward({
        iteration: 1,
        commits: ['feat: x'],
        filesChanged: [],
        validationSummary: 'a'.repeat(3000),
        criteriaFeedback: null
    });
    assert.ok(result.endsWith('...'));
    assert.ok(result.length <= CARRY_FORWARD_MAX_CHARS);
});

test('CARRY_FORWARD_MAX_CHARS is 2000', () => {
    assert.strictEqual(CARRY_FORWARD_MAX_CHARS, 2000);
});

report();
