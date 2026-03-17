#!/usr/bin/env node

'use strict';

const { COMMAND_ALIASES } = require('./lib/constants');
const { createFeatureCommands } = require('./lib/commands/feature');
const { createResearchCommands } = require('./lib/commands/research');
const { createFeedbackCommands } = require('./lib/commands/feedback');
const { createSetupCommands } = require('./lib/commands/setup');
const { createInfraCommands } = require('./lib/commands/infra');
const { createMiscCommands } = require('./lib/commands/misc');

const commands = {
    ...createFeatureCommands(),
    ...createResearchCommands(),
    ...createFeedbackCommands(),
    ...createSetupCommands(),
    ...createInfraCommands(),
    ...createMiscCommands(),
};

const args = process.argv.slice(2);
const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^aigon-/, '') : null;
const resolvedCommand = cleanCommand ? (COMMAND_ALIASES[cleanCommand] || cleanCommand) : cleanCommand;

if (!resolvedCommand || resolvedCommand === 'help' || resolvedCommand === '--help' || resolvedCommand === '-h') {
    commands.help();
} else if (commands[resolvedCommand]) {
    const result = commands[resolvedCommand](commandArgs);
    if (result && typeof result.catch === 'function') {
        result.catch(error => {
            console.error(`❌ ${error.message}`);
            process.exit(1);
        });
    }
} else {
    console.error(`Unknown command: ${commandName}\n`);
    commands.help();
}
