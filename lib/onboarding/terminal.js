'use strict';

const fs = require('fs');
const clack = require('@clack/prompts');
const terminalAdapters = require('../terminal-adapters');

async function selectTerminal(yesFlag = false) {
    if (process.platform !== 'darwin') return null;

    if (yesFlag) {
        return 'cmux';
    }

    const choice = await clack.select({
        message: 'Which terminal app do you use for agent sessions?',
        options: terminalAdapters.getPickerOptions({ platform: 'darwin' }),
        initialValue: 'cmux',
    });

    if (clack.isCancel(choice)) {
        clack.cancel('Setup cancelled.');
        process.exit(0);
    }

    return choice;
}

function saveTerminalPreference(terminalApp) {
    const cfg = require('../config');
    const { TERMINAL_CONFIG_MIGRATION_VERSION } = require('../global-config-migration');

    let rawConfig = {};
    if (fs.existsSync(cfg.GLOBAL_CONFIG_PATH)) {
        try {
            rawConfig = JSON.parse(fs.readFileSync(cfg.GLOBAL_CONFIG_PATH, 'utf8'));
        } catch (_) {}
    }

    cfg.saveGlobalConfig(Object.assign({}, rawConfig, {
        schemaVersion: TERMINAL_CONFIG_MIGRATION_VERSION,
        terminalApp,
        repos: rawConfig.repos || [],
    }));
}

module.exports = { selectTerminal, saveTerminalPreference };
