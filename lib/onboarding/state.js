'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_PATH = path.join(os.homedir(), '.aigon', 'onboarding-state.json');
const STEP_IDS = ['prereqs', 'terminal', 'agents', 'seed-repo', 'server', 'vault'];

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
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function markComplete() {
    const state = readOnboardingState();
    if (!state.steps) state.steps = {};
    state.completedAt = new Date().toISOString();
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function isOnboardingComplete(state) {
    if (!state || !state.steps) return false;
    return STEP_IDS.every(id => state.steps[id] === 'done' || state.steps[id] === 'skipped');
}

function getFirstIncompleteStep(state) {
    if (!state || !state.steps) return STEP_IDS[0];
    return STEP_IDS.find(id => !state.steps[id]) || null;
}

module.exports = {
    STATE_PATH,
    STEP_IDS,
    readOnboardingState,
    writeStepState,
    markComplete,
    isOnboardingComplete,
    getFirstIncompleteStep,
};
