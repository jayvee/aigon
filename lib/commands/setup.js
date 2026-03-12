'use strict';

const { createAllCommands } = require('./shared');

const COMMAND_NAMES = [
    "init",
    "install-agent",
    "check-version",
    "update",
    "hooks",
    "config",
    "profile",
    "doctor",
    "proxy-setup",
    "dev-server"
];

function createSetupCommands(overrides = {}) {
    const allCommands = createAllCommands(overrides);
    return Object.fromEntries(COMMAND_NAMES.map(name => [name, allCommands[name]]).filter(([, handler]) => typeof handler === 'function'));
}

module.exports = { createSetupCommands };
