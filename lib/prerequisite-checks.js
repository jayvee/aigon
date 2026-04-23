'use strict';

const { execSync } = require('child_process');
const { isBinaryAvailable } = require('./security');

const MIN_NODE_MAJOR = 18;

function getNodeVersion() {
    const raw = process.versions.node;
    const major = parseInt(raw.split('.')[0], 10);
    return { raw, major };
}

function getGitVersion() {
    try {
        const out = execSync('git --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
        return { found: true, version: out };
    } catch {
        return { found: false };
    }
}

function getNpmVersion() {
    try {
        const out = execSync('npm --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
        return { found: true, version: out };
    } catch {
        return { found: false };
    }
}

function checkAgentCLIs() {
    const agentRegistry = require('./agent-registry');
    const binMap = agentRegistry.getAgentBinMap();
    const hints = agentRegistry.getAgentInstallHints();
    const found = [];
    const missing = [];
    for (const [id, binary] of Object.entries(binMap)) {
        if (isBinaryAvailable(binary)) {
            found.push({ id, binary });
        } else {
            missing.push({ id, binary, hint: hints[id] });
        }
    }
    return { found, missing };
}

/**
 * Run all prerequisite checks and return categorised results.
 *
 * Returns:
 *   {
 *     errors:   [ { label, message, remediation } ]  — hard blockers
 *     warnings: [ { label, message, remediation } ]  — soft issues
 *     infos:    [ { label, message } ]               — passing / informational
 *     passed:   boolean   — true if no hard blockers
 *   }
 */
function runPrerequisiteChecks() {
    const errors = [];
    const warnings = [];
    const infos = [];

    // Node.js version
    const node = getNodeVersion();
    if (node.major < MIN_NODE_MAJOR) {
        errors.push({
            label: `Node.js ${node.raw}`,
            message: `Node.js ${MIN_NODE_MAJOR}+ is required (found ${node.raw}).`,
            remediation: 'Install: https://nodejs.org/ or use a version manager like nvm or fnm.',
        });
    } else {
        infos.push({ label: `Node.js ${node.raw}`, message: 'OK' });
    }

    // npm
    const npmResult = getNpmVersion();
    if (!npmResult.found) {
        errors.push({
            label: 'npm',
            message: 'npm is not available in PATH.',
            remediation: 'npm ships with Node.js — reinstall Node.js from https://nodejs.org/',
        });
    } else {
        infos.push({ label: `npm ${npmResult.version}`, message: 'OK' });
    }

    // git — hard requirement for all aigon workflows
    const git = getGitVersion();
    if (!git.found) {
        errors.push({
            label: 'git',
            message: 'git is not installed. Aigon requires git to manage feature branches and worktrees.',
            remediation: process.platform === 'darwin'
                ? 'Install: xcode-select --install  (or brew install git)'
                : 'Install: https://git-scm.com/downloads',
        });
    } else {
        infos.push({ label: git.version, message: 'OK' });
    }

    // tmux — needed for Fleet/worktree mode, optional for Drive mode
    if (isBinaryAvailable('tmux')) {
        try {
            const tmuxVer = execSync('tmux -V', { encoding: 'utf8', stdio: 'pipe' }).trim();
            infos.push({ label: tmuxVer, message: 'OK' });
        } catch {
            infos.push({ label: 'tmux', message: 'OK' });
        }
    } else {
        warnings.push({
            label: 'tmux',
            message: 'tmux is not installed. Required for Fleet/worktree mode; optional for single-agent Drive mode.',
            remediation: process.platform === 'darwin'
                ? 'Install: brew install tmux'
                : 'Install: sudo apt install tmux  (or dnf/pacman equivalent)',
        });
    }

    // Agent CLIs — need at least one to use aigon
    let agentCheck;
    try {
        agentCheck = checkAgentCLIs();
    } catch {
        agentCheck = null;
    }

    if (agentCheck) {
        if (agentCheck.found.length === 0 && agentCheck.missing.length > 0) {
            const examples = agentCheck.missing.slice(0, 2).map(a => a.id).join(', ');
            const hints = agentCheck.missing.slice(0, 1).map(a => a.hint).filter(Boolean);
            warnings.push({
                label: 'Agent CLIs',
                message: 'No AI agent CLI is installed. You need at least one to run features.',
                remediation: [
                    `Install an agent: aigon install-agent <id>  (e.g. ${examples})`,
                    ...hints,
                ].join('\n     '),
            });
        } else if (agentCheck.found.length > 0) {
            const names = agentCheck.found.map(a => a.binary).join(', ');
            infos.push({ label: `Agent CLIs (${names})`, message: 'OK' });
        }
    }

    return {
        errors,
        warnings,
        infos,
        passed: errors.length === 0,
    };
}

/**
 * Print check results to the console.
 *
 * Options:
 *   verbose  — also print passing checks (default false)
 *   prefix   — indent prefix for each line (default '  ')
 */
function printPrerequisiteResults(results, { verbose = false, prefix = '  ' } = {}) {
    const { errors, warnings, infos } = results;

    for (const e of errors) {
        console.error(`${prefix}❌ ${e.label}`);
        console.error(`${prefix}   ${e.message}`);
        console.error(`${prefix}   ${e.remediation}`);
    }

    for (const w of warnings) {
        console.warn(`${prefix}⚠️  ${w.label}`);
        console.warn(`${prefix}   ${w.message}`);
        console.warn(`${prefix}   ${w.remediation}`);
    }

    if (verbose) {
        for (const i of infos) {
            console.log(`${prefix}✅ ${i.label}`);
        }
    }
}

module.exports = { runPrerequisiteChecks, printPrerequisiteResults };
