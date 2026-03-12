'use strict';

const { createAllCommands } = require('./shared');

const COMMAND_NAMES = [
    "feature-create",
    "feature-prioritise",
    "feature-now",
    "feature-setup",
    "feature-do",
    "feature-submit",
    "feature-validate",
    "feature-eval",
    "feature-review",
    "feature-close",
    "feature-cleanup",
    "feature-autopilot",
    "feature-implement",
    "feature-done",
    "conduct"
];

function createFeatureCommands(overrides = {}) {
    const allCommands = createAllCommands(overrides);
    return Object.fromEntries(COMMAND_NAMES.map(name => [name, allCommands[name]]).filter(([, handler]) => typeof handler === 'function'));
}

module.exports = { createFeatureCommands };
