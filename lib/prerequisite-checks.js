'use strict';

const { getDetectors, getAgentDetectors } = require('./onboarding/detectors');

const MIN_NODE_MAJOR = 18;

// Message/remediation strings per detector id — output shape must match original exactly
const MESSAGES = {
    node: {
        failMessage: (version) => `Node.js ${MIN_NODE_MAJOR}+ is required (found ${version}).`,
        failRemediation: 'Install: https://nodejs.org/ or use a version manager like nvm or fnm.',
        failLabel: (version) => `Node.js ${version}`,
        okLabel: (version) => `Node.js ${version}`,
    },
    npm: {
        failMessage: 'npm is not available in PATH.',
        failRemediation: 'npm ships with Node.js — reinstall Node.js from https://nodejs.org/',
        failLabel: 'npm',
        okLabel: (version) => `npm ${version}`,
    },
    git: {
        failMessage: 'git is not installed. Aigon requires git to manage feature branches and worktrees.',
        failRemediation: process.platform === 'darwin'
            ? 'Install: xcode-select --install  (or brew install git)'
            : 'Install: https://git-scm.com/downloads',
        failLabel: 'git',
        okLabel: (version) => version,
    },
    gh: {
        failMessage: 'gh (GitHub CLI) is not installed.',
        failRemediation: process.platform === 'darwin'
            ? 'Install: brew install gh'
            : 'Install: sudo apt install gh',
        failLabel: 'gh',
        okLabel: (version) => version || 'gh',
    },
    tmux: {
        failMessage: 'tmux is not installed. Required for Fleet/worktree mode; optional for single-agent Drive mode.',
        failRemediation: process.platform === 'darwin'
            ? 'Install: brew install tmux'
            : 'Install: sudo apt install tmux  (or dnf/pacman equivalent)',
        failLabel: 'tmux',
        okLabel: (version) => version || 'tmux',
    },
};

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
async function runPrerequisiteChecks() {
    const errors = [];
    const warnings = [];
    const infos = [];

    for (const detector of getDetectors()) {
        const result = await detector.check();
        const msg = MESSAGES[detector.id];

        if (!result.found) {
            const entry = {
                label: msg ? (typeof msg.failLabel === 'function' ? msg.failLabel(result.version) : msg.failLabel) : detector.label,
                message: msg ? (typeof msg.failMessage === 'function' ? msg.failMessage(result.version) : msg.failMessage) : `${detector.label} is not available.`,
                remediation: msg ? msg.failRemediation : '',
            };
            if (detector.required) {
                errors.push(entry);
            } else {
                warnings.push(entry);
            }
        } else {
            const label = msg ? (typeof msg.okLabel === 'function' ? msg.okLabel(result.version) : msg.okLabel) : detector.label;
            infos.push({ label, message: 'OK' });
        }
    }

    // Agent CLIs — aggregate into a batch result matching original output
    let agentDetectors;
    try {
        agentDetectors = getAgentDetectors();
    } catch {
        agentDetectors = [];
    }

    if (agentDetectors.length > 0) {
        const found = [];
        const missing = [];
        for (const detector of agentDetectors) {
            const result = await detector.check();
            const agentId = detector.id.replace(/^agent:/, '');
            const agentRegistry = require('./agent-registry');
            const agent = agentRegistry.getAgent(agentId);
            const binary = agent && agent.cli && agent.cli.command;
            if (result.found) {
                found.push({ id: agentId, binary: binary || agentId });
            } else {
                const hint = agent && agent.installHint;
                missing.push({ id: agentId, binary: binary || agentId, hint });
            }
        }

        if (found.length === 0 && missing.length > 0) {
            const examples = missing.slice(0, 2).map(a => a.id).join(', ');
            const hints = missing.slice(0, 1).map(a => a.hint).filter(Boolean);
            warnings.push({
                label: 'Agent CLIs',
                message: 'No AI agent CLI is installed. You need at least one to run features.',
                remediation: [
                    `Install an agent: aigon install-agent <id>  (e.g. ${examples})`,
                    ...hints,
                ].join('\n     '),
            });
        } else if (found.length > 0) {
            const names = found.map(a => a.binary).join(', ');
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
