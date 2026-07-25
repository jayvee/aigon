'use strict';

const assert = require('assert');
const state = require('../../lib/onboarding/state');

let failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

// REGRESSION: skipped and failed setup steps must remain visible and resumable.
test('selects skipped before failed and preserves completed work on resume', () => {
    const partial = { steps: { prereqs: 'done', terminal: 'skipped', agents: 'failed', pro: 'done' } };
    assert.strictEqual(state.getFirstResumableStep(partial), 'terminal');
    assert.strictEqual(state.shouldRunStep('prereqs', { state: partial, resume: true }), false);
    assert.strictEqual(state.shouldRunStep('terminal', { state: partial, resume: true }), true);
    assert.strictEqual(state.shouldRunStep('agents', { state: partial, resume: true }), true);
});

// REGRESSION: explicit retry accepts only canonical persisted wizard step IDs.
test('runs only explicit step selections and rejects invalid IDs', () => {
    const selectedSteps = ['server', 'seed-repo'];
    assert.strictEqual(state.shouldRunStep('server', { selectedSteps }), true);
    assert.strictEqual(state.shouldRunStep('demo', { selectedSteps }), false);
    assert.deepStrictEqual(state.validateStepIds(['server', 'nope', 'server']), ['nope']);
});

// REGRESSION: normal completion still treats an intentional skip as complete.
test('distinguishes normal completion from resumable skipped work', () => {
    const complete = { steps: Object.fromEntries(state.STEP_IDS.map(id => [id, 'skipped'])) };
    assert.strictEqual(state.isOnboardingComplete(complete), true);
    assert.strictEqual(state.getFirstResumableStep(complete), state.STEP_IDS[0]);
});

if (failed) process.exit(1);
