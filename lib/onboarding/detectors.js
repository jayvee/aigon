'use strict';

const { execSync, spawnSync } = require('child_process');
const { isBinaryAvailable } = require('../security');

const MIN_NODE_MAJOR = 18;

function _runInstall(cmd) {
    if (!cmd) return { ok: false, output: 'No install command available' };
    // inherit stdio so the user sees live output (spinners, apt progress, etc.)
    const result = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', stdio: 'inherit' });
    return { ok: result.status === 0, output: '' };
}

function _platformInstall(macCmd, linuxCmd) {
    const cmd = process.platform === 'darwin' ? macCmd : linuxCmd;
    if (!cmd) return { ok: false, output: 'Manual install required — see https://nodejs.org/' };
    return _runInstall(cmd);
}

const CORE_DETECTORS = [
    {
        id: 'node',
        label: 'Node.js',
        required: true,
        async check() {
            const raw = process.versions.node;
            const major = parseInt(raw.split('.')[0], 10);
            if (major < MIN_NODE_MAJOR) return { found: false, version: raw };
            return { found: true, version: raw };
        },
        async install() {
            return { ok: false, output: 'Manual install required: https://nodejs.org/ or use nvm/fnm' };
        },
        async verify() { return this.check(); },
    },
    {
        id: 'npm',
        label: 'npm',
        required: true,
        async check() {
            try {
                const version = execSync('npm --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
                return { found: true, version };
            } catch {
                return { found: false };
            }
        },
        async install() {
            return { ok: false, output: 'npm ships with Node.js — reinstall Node.js from https://nodejs.org/' };
        },
        async verify() { return this.check(); },
    },
    {
        id: 'git',
        label: 'git',
        required: true,
        async check() {
            try {
                const version = execSync('git --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
                return { found: true, version };
            } catch {
                return { found: false };
            }
        },
        async install() {
            return _platformInstall('xcode-select --install', null);
        },
        async verify() { return this.check(); },
    },
    {
        id: 'gh',
        label: 'gh (GitHub CLI)',
        required: false,
        async check() {
            if (!isBinaryAvailable('gh')) return { found: false };
            try {
                const version = execSync('gh --version', { encoding: 'utf8', stdio: 'pipe' }).trim().split('\n')[0];
                return { found: true, version };
            } catch {
                return { found: true };
            }
        },
        async install() {
            const linuxCmd = [
                '(type -p wget >/dev/null || (sudo apt-get update && sudo apt-get install wget -y))',
                'sudo mkdir -p -m 755 /etc/apt/keyrings',
                'out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg',
                'cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null',
                'sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg',
                'sudo mkdir -p -m 755 /etc/apt/sources.list.d',
                'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
                'sudo apt-get update && sudo apt-get install gh -y',
            ].join(' && ');
            return _platformInstall('brew install gh', linuxCmd);
        },
        async verify() { return this.check(); },
    },
    {
        id: 'tmux',
        label: 'tmux',
        required: false,
        async check() {
            if (!isBinaryAvailable('tmux')) return { found: false };
            try {
                const version = execSync('tmux -V', { encoding: 'utf8', stdio: 'pipe' }).trim();
                return { found: true, version };
            } catch {
                return { found: true };
            }
        },
        async install() {
            return _platformInstall('brew install tmux', 'sudo apt install tmux');
        },
        async verify() { return this.check(); },
    },
];

function getDetectors() {
    return CORE_DETECTORS;
}

function getAgentDetectors() {
    const agentRegistry = require('../agent-registry');
    return agentRegistry.getAllAgents().map(agent => {
        const binary = agent.cli && agent.cli.command;
        const installCommand = agent.installCommand || null;
        const installHint = agent.installHint || null;

        return {
            id: `agent:${agent.id}`,
            label: agent.displayName || agent.name || agent.id,
            required: false,
            async check() {
                if (!binary || !isBinaryAvailable(binary)) return { found: false };
                return { found: true };
            },
            async install() {
                if (installCommand) return _runInstall(installCommand);
                if (installHint) return { ok: false, output: `Manual install required: ${installHint}` };
                return { ok: false, output: 'No install command available' };
            },
            async verify() { return this.check(); },
        };
    });
}

module.exports = { getDetectors, getAgentDetectors };
