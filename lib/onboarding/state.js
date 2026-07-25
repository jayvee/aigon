'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_PATH = path.join(os.homedir(), '.aigon', 'onboarding-state.json');
const STEP_IDS = ['prereqs', 'terminal', 'agents', 'pro', 'seed-repo', 'repos', 'server', 'demo', 'vault'];

function writeState(state) {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tempPath = `${STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, STATE_PATH);
    fs.chmodSync(STATE_PATH, 0o600);
}

function readOnboardingState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
        return { steps: {}, completedAt: null };
    }
}

function writeStepState(stepId, status) {
    const state = readOnboardingState();
    if (!state.steps) state.steps = {};
    state.steps[stepId] = status;
    writeState(state);
}

function markComplete() {
    const state = readOnboardingState();
    if (!state.steps) state.steps = {};
    state.completedAt = new Date().toISOString();
    writeState(state);
}

function isOnboardingComplete(state) {
    if (!state || !state.steps) return false;
    return STEP_IDS.every(id => state.steps[id] === 'done' || state.steps[id] === 'skipped');
}

function getFirstIncompleteStep(state) {
    if (!state || !state.steps) return STEP_IDS[0];
    return STEP_IDS.find(id => !state.steps[id]) || null;
}

// Resume deliberately includes intentional skips and prior failures: both are
// operator-visible choices/results that may be retried without resetting done work.
function getFirstResumableStep(state) {
    if (!state || !state.steps) return STEP_IDS[0];
    return STEP_IDS.find(id => state.steps[id] !== 'done') || null;
}

function validateStepIds(stepIds) {
    return [...new Set(stepIds)].filter(id => !STEP_IDS.includes(id));
}

function shouldRunStep(stepId, { state, resume = false, selectedSteps = [] } = {}) {
    if (selectedSteps.length > 0) return selectedSteps.includes(stepId);
    const status = state && state.steps && state.steps[stepId];
    return resume ? status !== 'done' : status !== 'done' && status !== 'skipped';
}

module.exports = {
    STATE_PATH,
    STEP_IDS,
    readOnboardingState,
    writeStepState,
    markComplete,
    isOnboardingComplete,
    getFirstIncompleteStep,
    getFirstResumableStep,
    validateStepIds,
    shouldRunStep,
};
