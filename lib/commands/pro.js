'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

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

function isServerRunning() {
    const cli = process.argv[1];
    const result = spawnSync(process.execPath, [cli, 'server', 'status'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AIGON_SKIP_FIRST_RUN: '1' },
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    return /Server:\s+(running|unhealthy)\b/.test(output);
}

function restartServerInBackground() {
    const cli = process.argv[1];
    const logPath = path.join(os.homedir(), '.aigon', 'dashboard.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, 'a');
    const child = spawn(process.execPath, [cli, 'server', 'restart'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, AIGON_SKIP_FIRST_RUN: '1' },
    });
    child.unref();
    return logPath;
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
    if (isServerRunning()) {
        const logPath = restartServerInBackground();
        console.log('🔄 Dashboard server restart triggered in the background.');
        console.log(`   Log: ${logPath}`);
    } else {
        console.log('   Start the dashboard with: aigon server start');
    }
}

function handleStatus() {
    let installed = false;
    let resolvedPath = null;
    try {
        const pro = require('../pro');
        resolvedPath = pro.getProResolvedPath();
        installed = Boolean(resolvedPath);
    } catch (_) {}

    if (!installed) {
        try {
            resolvedPath = require.resolve('@senlabsai/aigon-pro');
            installed = true;
        } catch (_) {}
    }

    let activated = false;
    let loadError = null;
    try {
        const pro = require('../pro');
        activated = pro.isProAvailable();
        try { loadError = pro.getProStatus().loadError; } catch (_) {}
    } catch (_) {
        activated = false;
    }

    try {
        require.resolve('@senlabsai/aigon-pro');
        installed = true;
    } catch (_) {}

    const config = readRawGlobalConfig();
    const hasKey = Boolean(config.proKey);

    console.log(`Package @senlabsai/aigon-pro: ${installed ? '✅ installed' : '❌ not installed'}`);
    if (resolvedPath) console.log(`Resolved from: ${resolvedPath}`);
    console.log(`Pro key (~/.aigon/config.json):  ${hasKey ? '✅ present' : '❌ not set'}`);

    if (!installed) {
        console.log('\nInstall: npm install -g @senlabsai/aigon-pro');
    }
    if (!hasKey) {
        console.log('Activate: aigon pro activate <your-key>');
    }
    if (installed && hasKey && activated) {
        console.log('\nPro is active.');
    } else if (installed && hasKey && !activated) {
        console.log('\nPro package and key are present, but Pro did not activate in this process.');
        if (loadError) {
            console.log(`Load error: ${loadError}`);
            console.log('(the package resolves on disk but failed to load — often a missing');
            console.log(' dependency; for a local checkout run: npm link @senlabsai/aigon in the aigon-pro repo)');
        }
        console.log('Run: aigon pro activate <your-key>');
    } else if (loadError) {
        console.log(`\nPro load error: ${loadError}`);
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
