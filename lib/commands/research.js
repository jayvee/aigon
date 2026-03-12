'use strict';

const { createAllCommands } = require('./shared');

const COMMAND_NAMES = [
    "research-create",
    "research-prioritise",
    "research-setup",
    "research-open",
    "research-do",
    "research-submit",
    "research-synthesize",
    "research-close",
    "research-autopilot",
    "research-conduct",
    "research-done"
];

function createResearchCommands(overrides = {}) {
    const allCommands = createAllCommands(overrides);
    return Object.fromEntries(COMMAND_NAMES.map(name => [name, allCommands[name]]).filter(([, handler]) => typeof handler === 'function'));
}

module.exports = { createResearchCommands };
