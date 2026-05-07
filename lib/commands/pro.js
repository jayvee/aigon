'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function getGlobalConfigPath() {
    return path.resolve(process.env.GLOBAL_CONFIG_PATH || path.join(os.homedir(), '.aigon', 'config.json'));
}

function readRawGlobalConfig() {
    const p = getGlobalConfigPath();
    if (!fs.existsSync(p)) return {};
    try {
        const raw = fs.readFileSync(p, 'utf8').trim();
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

function writeRawGlobalConfig(config) {
    const p = getGlobalConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

function handleActivate(args) {
    const key = args[0];
    if (!key) {
        console.error('Usage: aigon pro activate <key>');
        process.exitCode = 1;
        return;
    }
    const config = readRawGlobalConfig();
    config.proKey = key;
    writeRawGlobalConfig(config);
    console.log('✅ Pro key saved to ~/.aigon/config.json');
    console.log('   Restart the server for changes to take effect: aigon server restart');
}

function handleStatus() {
    let installed = false;
    try {
        require.resolve('@senlabsai/aigon-pro');
        installed = true;
    } catch (_) {}

    const config = readRawGlobalConfig();
    const hasKey = Boolean(config.proKey);

    console.log(`Package @senlabsai/aigon-pro: ${installed ? '✅ installed' : '❌ not installed'}`);
    console.log(`Pro key (~/.aigon/config.json):  ${hasKey ? '✅ present' : '❌ not set'}`);

    if (!installed) {
        console.log('\nInstall: npm install -g @senlabsai/aigon-pro');
    }
    if (!hasKey) {
        console.log('Activate: aigon pro activate <your-key>');
    }
    if (installed && hasKey) {
        console.log('\nPro is active. Run `aigon server restart` if the server is running.');
    }
}

function printHelp() {
    console.log('Usage: aigon pro <subcommand>');
    console.log('');
    console.log('Subcommands:');
    console.log('  activate <key>   Save a Pro key to ~/.aigon/config.json');
    console.log('  status           Show Pro package and key status');
}

function createProCommands() {
    return {
        pro: (rawArgs) => {
            const subcommand = (rawArgs || [])[0];
            const rest = (rawArgs || []).slice(1);
            switch (subcommand) {
                case 'activate':
                    return handleActivate(rest);
                case 'status':
                    return handleStatus();
                case undefined:
                case 'help':
                case '--help':
                case '-h':
                    return printHelp();
                default:
                    console.error(`Unknown pro subcommand: ${subcommand}`);
                    console.error('Try: aigon pro help');
                    process.exitCode = 1;
                    return;
            }
        },
    };
}

module.exports = { createProCommands };
