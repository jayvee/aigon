'use strict';

const { createAllCommands } = require('./shared');

const COMMAND_NAMES = [
    "feedback-create",
    "feedback-list",
    "feedback-triage"
];

function createFeedbackCommands(overrides = {}) {
    const allCommands = createAllCommands(overrides);
    return Object.fromEntries(COMMAND_NAMES.map(name => [name, allCommands[name]]).filter(([, handler]) => typeof handler === 'function'));
}

module.exports = { createFeedbackCommands };
