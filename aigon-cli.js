#!/usr/bin/env node

'use strict';

/**
 * Format a CLI error for the user. SyntaxError / module-load failures are
 * surfaced with the offending file path so a half-applied stash or merge
 * conflict in `lib/*.js` produces an actionable message instead of an
 * opaque "Unexpected token '<<'" toast in the dashboard. (See
 * farline-ai-forge feature 42 close failure on 2026-04-08.)
 */
function formatCliError(error) {
    if (!error) return '❌ Unknown error';
    const isLoadError = error instanceof SyntaxError
        || (error && (error.code === 'ERR_REQUIRE_ESM' || error.code === 'MODULE_NOT_FOUND'));
    if (isLoadError) {
        // Extract first stack frame containing a file path so the user knows
        // which module failed to load. SyntaxError.message strips the path.
        const stack = typeof error.stack === 'string' ? error.stack : '';
        const frame = stack.split('\n').find(line => /\.js[:\)]/.test(line));
        const where = frame ? frame.trim() : '(unknown location)';
        return `❌ aigon failed to load a module: ${error.message}\n   at ${where}\n`
            + `   This usually means a file in lib/ has a syntax error or unresolved\n`
            + `   merge conflict. Check: grep -rn '^<<<<<<<' "$(dirname "$(readlink -f "$0")")/lib"`;
    }
    // For runtime errors, include the stack so crash-loops and server boot
    // failures produce actionable output. Set AIGON_NO_STACK=1 to suppress
    // if it's ever too noisy for a given UX path.
    const stack = typeof error.stack === 'string' ? error.stack : '';
    if (process.env.AIGON_NO_STACK === '1' || !stack) {
        return `❌ ${error.message}`;
    }
    return `❌ ${error.message}\n${stack}`;
}

let COMMAND_ALIASES;
let createFeatureCommands, createResearchCommands, createFeedbackCommands;
let createSetupCommands, createInfraCommands, createMiscCommands, createWorkflowCommands, createSetCommands;
let createRecurringCommands, createScheduleCommands;
let checkForUpdate, getCachedUpdateCheck, formatUpdateNotice;
let createSecurityScanCommands;

try {
    ({ COMMAND_ALIASES } = require('./lib/constants'));
    ({ createFeatureCommands } = require('./lib/commands/feature'));
    ({ createResearchCommands } = require('./lib/commands/research'));
    ({ createFeedbackCommands } = require('./lib/commands/feedback'));
    ({ createSetupCommands } = require('./lib/commands/setup'));
    ({ createInfraCommands } = require('./lib/commands/infra'));
    ({ createMiscCommands } = require('./lib/commands/misc'));
    ({ createWorkflowCommands } = require('./lib/commands/workflow'));
    ({ createSetCommands } = require('./lib/commands/set'));
    ({ createRecurringCommands } = require('./lib/commands/recurring'));
    ({ createScheduleCommands } = require('./lib/commands/schedule'));
    ({ createSecurityScanCommands } = require('./lib/commands/security-scan'));
    ({ checkForUpdate, getCachedUpdateCheck, formatUpdateNotice } = require('./lib/npm-update-check'));
} catch (error) {
    console.error(formatCliError(error));
    process.exit(1);
}

// Commands that emit machine-readable output or are called programmatically — suppress update notices for these.
const PLUMBING_COMMANDS = new Set([
    'feature-spec-review-record',
    'sync-heartbeat',
    'session-hook',
    'agent-status',
]);

const commands = {
    ...createFeatureCommands(),
    ...createResearchCommands(),
    ...createFeedbackCommands(),
    ...createSetupCommands(),
    ...createInfraCommands(),
    ...createMiscCommands(),
    ...createWorkflowCommands(),
    ...createSetCommands(),
    ...createRecurringCommands(),
    ...createScheduleCommands(),
    ...createSecurityScanCommands(),
};

const args = process.argv.slice(2);
const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^aigon-/, '') : null;
const resolvedCommand = cleanCommand ? (COMMAND_ALIASES[cleanCommand] || cleanCommand) : cleanCommand;

const SKIP_FIRST_RUN = new Set(['onboarding', 'setup', '--version', '-v', 'version', '--help', '-h', 'help', 'check-version', 'update']);

function firstRunComplete() {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    // Check global config for onboarded flag
    const globalConfigPath = path.join(os.homedir(), '.aigon', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
            if (cfg.onboarded === true) return true;
        } catch (_) {}
    }
    // Check onboarding state file for all steps complete
    const statePath = path.join(os.homedir(), '.aigon', 'onboarding-state.json');
    if (!fs.existsSync(statePath)) return false;
    try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const steps = state.steps || {};
        const STEP_IDS = ['prereqs', 'terminal', 'agents', 'seed-repo', 'server'];
        return STEP_IDS.every(id => steps[id] === 'done' || steps[id] === 'skipped');
    } catch (_) {
        return false;
    }
}

const shouldNotifyUpdates = (
    process.stdout.isTTY &&
    process.env.AIGON_NO_UPDATE_NOTIFIER !== '1' &&
    !PLUMBING_COMMANDS.has(resolvedCommand)
);

// Fire background update check so the cache is warm for this and future commands.
if (shouldNotifyUpdates) {
    checkForUpdate({ unref: true }).catch(() => {}); // fire-and-forget
}

async function main() {
    if (resolvedCommand === '--version' || resolvedCommand === '-v' || resolvedCommand === 'version') {
        console.log(require('./package.json').version);
        return;
    }

    if (!resolvedCommand || resolvedCommand === 'help' || resolvedCommand === '--help' || resolvedCommand === '-h') {
        commands.help();
        return;
    }

    const isInteractiveEnv = process.stdin.isTTY && process.stdout.isTTY && !process.env.CI && !process.env.AIGON_SKIP_FIRST_RUN;
    if (isInteractiveEnv && !SKIP_FIRST_RUN.has(resolvedCommand) && !firstRunComplete()) {
        try {
            await commands['onboarding']([]);
        } catch (error) {
            console.error(formatCliError(error));
            process.exit(1);
        }
    }

    if (commands[resolvedCommand]) {
        let result;
        try {
            result = await commands[resolvedCommand](commandArgs);
        } catch (error) {
            console.error(formatCliError(error));
            process.exit(1);
        }
        if (result && typeof result.catch === 'function') {
            result.catch(error => {
                console.error(formatCliError(error));
                process.exit(1);
            });
        }
    } else {
        console.error(`Unknown command: ${commandName}\n`);
        commands.help();
    }
}

main().then(() => {
    if (shouldNotifyUpdates) {
        const notice = formatUpdateNotice(getCachedUpdateCheck());
        if (notice) process.stderr.write(notice + '\n');
    }
}).catch(error => {
    console.error(formatCliError(error));
    process.exit(1);
});
