#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const state = require('../../lib/onboarding/state');

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

// REGRESSION (F695): the wizard is eight steps and 'pro' is no longer one of them.
test('exposes the eight canonical wizard steps in order', () => {
    assert.deepStrictEqual(state.STEP_IDS, ['prereqs', 'terminal', 'agents', 'seed-repo', 'repos', 'server', 'demo', 'vault']);
    assert.strictEqual(state.getFirstIncompleteStep({ steps: {} }), 'prereqs');
    assert.strictEqual(state.getFirstResumableStep(null), 'prereqs');
    assert.deepStrictEqual(state.validateStepIds(['pro']), ['pro']);
});

// REGRESSION (F695): a state file written before the Pro step was removed must
// resume at the step after it, not re-run completed work and not throw.
test('ignores a legacy steps.pro entry when resuming', () => {
    const legacy = { steps: { prereqs: 'done', terminal: 'done', agents: 'done', pro: 'skipped' } };
    assert.strictEqual(state.getFirstIncompleteStep(legacy), 'seed-repo');
    assert.strictEqual(state.getFirstResumableStep(legacy), 'seed-repo');
    assert.strictEqual(state.isOnboardingComplete(legacy), false);
});

// REGRESSION (F695): a fully-done nine-step state file must read as complete
// forever, not stall on the removed step.
test('treats a complete legacy nine-step state as complete', () => {
    const legacy = { steps: Object.fromEntries([...state.STEP_IDS, 'pro'].map(id => [id, 'done'])) };
    assert.strictEqual(state.isOnboardingComplete(legacy), true);
    assert.strictEqual(state.getFirstIncompleteStep(legacy), null);
    assert.strictEqual(state.getFirstResumableStep(legacy), null);
});

// REGRESSION (F695): shouldRunStep must not treat an unknown startStep (indexOf
// === -1, e.g. a resume from a state file written mid-'pro') as "before every
// step", which would silently re-run the whole wizard.
test('wizard shouldRunStep survives a removed startStep', () => {
    const { shouldRunStep } = require('../../lib/onboarding/wizard');
    const legacy = { steps: { prereqs: 'done', terminal: 'done', agents: 'done', pro: 'skipped' } };
    const options = { resumeFlag: true, selectedSteps: [] };
    assert.strictEqual(shouldRunStep('prereqs', 'pro', legacy, options), false);
    assert.strictEqual(shouldRunStep('agents', 'pro', legacy, options), false);
    assert.strictEqual(shouldRunStep('seed-repo', 'pro', legacy, options), true);
    assert.strictEqual(shouldRunStep('seed-repo', 'server', legacy, options), false);
    assert.strictEqual(shouldRunStep('server', 'server', legacy, options), true);
});

report();
