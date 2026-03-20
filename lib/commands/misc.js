'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { writeAgentStatusAt, readAgentStatus } = require('../manifest');

module.exports = function miscCommands(ctx) {
    const u = ctx.utils;
    const { getCurrentBranch } = ctx.git;

    const {
        PATHS,
        readTemplate,
        runDeployCommand,
    } = u;

    return {
        'agent-status': (args) => {
            const status = args[0];
            const validStatuses = ['implementing', 'waiting', 'submitted', 'error'];
            if (!status || !validStatuses.includes(status)) {
                return console.error(`Usage: aigon agent-status <status>\n\nValid statuses: ${validStatuses.join(', ')}\n\nExample: aigon agent-status waiting`);
            }

            // Detect branch
            const branch = getCurrentBranch();
            if (!branch) {
                return console.error('❌ Could not detect current branch.');
            }

            // Parse feature ID and agent from branch name
            // Arena/worktree: feature-<ID>-<agent>-<desc>
            // Solo: feature-<ID>-<desc>
            const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
            const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);

            let featureNum, agentId;
            if (arenaMatch) {
                featureNum = arenaMatch[1].padStart(2, '0');
                agentId = arenaMatch[2];
            } else if (soloMatch) {
                featureNum = soloMatch[1].padStart(2, '0');
                agentId = 'solo';
            } else {
                return console.error(`❌ Branch "${branch}" does not match a feature branch pattern (feature-<ID>-...)`);
            }

            // Resolve main repo: worktrees write to the main repo's state dir
            let mainRepo = process.cwd();
            const worktreeJsonPath = path.join(process.cwd(), '.aigon', 'worktree.json');
            if (fs.existsSync(worktreeJsonPath)) {
                try {
                    const wj = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
                    if (wj.mainRepo) mainRepo = wj.mainRepo;
                } catch (e) { /* use cwd fallback */ }
            }

            // Write status to main repo's .aigon/state/feature-{id}-{agent}.json
            writeAgentStatusAt(mainRepo, featureNum, agentId, {
                status,
                worktreePath: process.cwd(),
            });

            // Find log file name for the confirmation message (best-effort)
            let logLabel = `feature-${featureNum}-${agentId}`;
            try {
                const logsDir = path.join(PATHS.features.root, 'logs');
                if (fs.existsSync(logsDir)) {
                    const logPattern = agentId === 'solo'
                        ? `feature-${featureNum}-`
                        : `feature-${featureNum}-${agentId}-`;
                    const logFiles = fs.readdirSync(logsDir)
                        .filter(f => f.startsWith(logPattern) && f.endsWith('-log.md'));
                    const filtered = agentId === 'solo'
                        ? logFiles.filter(f => !f.match(new RegExp(`^feature-${featureNum}-[a-z]{2}-`)))
                        : logFiles;
                    if (filtered.length > 0) logLabel = filtered[0];
                }
            } catch (e) { /* ignore */ }

            console.log(`✅ Status updated: ${status} (${logLabel})`);
        },

        'status': (args) => {
            const idArg = args[0] && !args[0].startsWith('--') ? args[0] : null;
            const logsDir = path.join(PATHS.features.root, 'logs');
            const inProgressDir = path.join(PATHS.features.root, '03-in-progress');

            if (!fs.existsSync(logsDir)) {
                return console.error('❌ No logs directory found. Run aigon feature-start first.');
            }

            // Helper: extract feature name from spec filename
            function featureNameFromSpec(filename) {
                // feature-31-log-status-tracking.md -> log-status-tracking
                const m = filename.match(/^feature-\d+-(.+)\.md$/);
                return m ? m[1] : filename;
            }

            let featureIds = [];
            if (idArg) {
                featureIds = [String(parseInt(idArg, 10)).padStart(2, '0')];
            } else {
                // Find all in-progress features
                if (!fs.existsSync(inProgressDir)) {
                    return console.log('No features in progress.');
                }
                featureIds = fs.readdirSync(inProgressDir)
                    .filter(f => f.match(/^feature-\d+-.+\.md$/))
                    .map(f => {
                        const m = f.match(/^feature-(\d+)-/);
                        return m ? m[1].padStart(2, '0') : null;
                    })
                    .filter(Boolean);
            }

            if (featureIds.length === 0) {
                return console.log('No features in progress.');
            }

            let anyOutput = false;
            featureIds.forEach(featureNum => {
                // Get feature name from spec file
                let featureName = featureNum;
                if (fs.existsSync(inProgressDir)) {
                    const specFile = fs.readdirSync(inProgressDir).find(f => f.startsWith(`feature-${featureNum}-`));
                    if (specFile) featureName = featureNameFromSpec(specFile);
                }

                // Find all log files for this feature (excluding selected/alternatives subdirs)
                const allLogs = fs.readdirSync(logsDir)
                    .filter(f => f.startsWith(`feature-${featureNum}-`) && f.endsWith('-log.md'));

                if (allLogs.length === 0) return;

                anyOutput = true;
                console.log(`\n#${featureNum}  ${featureName}`);

                allLogs.forEach(logFile => {
                    // Determine agent label
                    // Arena: feature-31-cc-desc-log.md -> cc
                    // Solo: feature-31-desc-log.md -> solo
                    const arenaM = logFile.match(new RegExp(`^feature-${featureNum}-([a-z]{2})-`));
                    const agent = arenaM ? arenaM[1] : 'solo';

                    let status = 'unknown';
                    let timeStr = '';
                    try {
                        const agentState = readAgentStatus(featureNum, agent);
                        if (agentState) {
                            status = agentState.status || 'unknown';
                            if (agentState.updatedAt) {
                                const d = new Date(agentState.updatedAt);
                                if (!isNaN(d)) {
                                    timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                                }
                            }
                        }
                    } catch (e) { /* skip */ }

                    const statusPad = status.padEnd(14);
                    const agentPad = agent.padEnd(6);
                    console.log(`  ${agentPad} ${statusPad} ${timeStr}`);
                });
            });

            if (!anyOutput) {
                console.log(idArg ? `No log files found for feature #${idArg}.` : 'No log files found for in-progress features.');
            }
        },

        'deploy': (args) => {
            const isPreview = args.includes('--preview');
            const exitCode = runDeployCommand(isPreview);
            if (exitCode !== 0) process.exitCode = exitCode;
        },

        'next': () => {
            console.log(`ℹ️  'aigon next' is an agent-only command.\n\nRun it inside your agent session:\n  /aigon:next\n\nOr use the short alias:\n  /an`);
        },

        'help': () => {
            const helpText = readTemplate('help.txt');
            process.stdout.write(helpText);
        },
    };
};

// Backward-compat wrapper
function createMiscCommands(overrides = {}) {
    const utils = require('../utils');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const stateMachine = require('../state-machine');

    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    const names = ['agent-status', 'status', 'deploy', 'next', 'help'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createMiscCommands = createMiscCommands;
