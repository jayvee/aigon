'use strict';

const { createAllCommands } = require('./shared');

const COMMAND_NAMES = [
    "agent-status",
    "status",
    "deploy",
    "radar",
    "conductor",
    "dashboard",
    "terminal-focus",
    "board",
    "worktree-open",
    "sessions-close",
    "next",
    "help"
];

function createMiscCommands(overrides = {}) {
    const allCommands = createAllCommands(overrides);
    return Object.fromEntries(COMMAND_NAMES.map(name => [name, allCommands[name]]).filter(([, handler]) => typeof handler === 'function'));
}

module.exports = { createMiscCommands };
