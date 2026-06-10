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
let createAgentLaunchCommands;
let createSignalHealthCommands;
let checkForUpdate, getCachedUpdateCheck, formatUpdateNotice;
let createSecurityScanCommands;
let createProCommands;

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
    ({ createAgentLaunchCommands } = require('./lib/commands/agent-launch'));
    ({ createSignalHealthCommands } = require('./lib/commands/signal-health'));
    ({ createSecurityScanCommands } = require('./lib/commands/security-scan'));
    ({ createProCommands } = require('./lib/commands/pro'));
    ({ checkForUpdate, getCachedUpdateCheck, formatUpdateNotice } = require('./lib/npm-update-check'));
} catch (error) {
    console.error(formatCliError(error));
    process.exit(1);
}

// Commands that emit machine-readable output or are called programmatically — suppress update notices for these.
const PLUMBING_COMMANDS = new Set([
    'feature-spec-review-record',
    'agent-context',
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
    ...createAgentLaunchCommands(),
    ...createSignalHealthCommands(),
    ...createSecurityScanCommands(),
    ...createProCommands(),
};

const args = process.argv.slice(2);
const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^aigon-/, '') : null;
const resolvedCommand = cleanCommand ? (COMMAND_ALIASES[cleanCommand] || cleanCommand) : cleanCommand;

const SKIP_FIRST_RUN = new Set([
    ...PLUMBING_COMMANDS,
    'onboarding',
    'setup',
    // F544: autonomous orchestration runs unattended inside a tmux pane (which
    // HAS a TTY), so the interactive first-run gate must never fire here — a
    // mis-resolved HOME would otherwise surface the setup wizard mid-run instead
    // of executing the feature. The orchestrator also exports AIGON_SKIP_FIRST_RUN
    // to its child aigon calls (see lib/feature-autonomous.js loopCmd).
    'feature-autonomous-start',
    '--version',
    '-v',
    'version',
    '--help',
    '-h',
    'help',
    'check-version',
    'apply',
    'update',
    'installed-notice',
]);

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
        const STEP_IDS = ['prereqs', 'terminal', 'agents', 'pro', 'seed-repo', 'repos', 'server', 'demo', 'vault'];
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

// F502 Layer 1+2: template-vs-installed drift detection at CLI startup.
// Layer 1 prints a one-line warning per affected agent; Layer 2 silently
// re-runs install-agent on aigon version bump. Both bail out cheaply when
// the template fingerprint hasn't changed (mtime cache).
const TEMPLATE_DRIFT_SKIP = new Set([
    '--version', '-v', 'version', '--help', '-h', 'help',
    'install-agent', 'uninstall', 'doctor', 'setup', 'global-setup',
    'check-version', 'check-prerequisites', 'apply', 'update',
    'installed-notice',
    'agent-context', 'sync-heartbeat', 'session-hook', 'agent-status',
]);
async function maybeRunTemplateDriftLayers(cmd) {
    if (TEMPLATE_DRIFT_SKIP.has(cmd)) return;
    if (process.env.AIGON_SKIP_TEMPLATE_DRIFT === '1') return;
    let driftLib, installManifestLib, fs, path;
    try {
        driftLib = require('./lib/template-drift');
        installManifestLib = require('./lib/install-manifest');
        fs = require('fs');
        path = require('path');
    } catch (_) { return; }
    const repoRoot = process.cwd();
    if (!fs.existsSync(path.join(repoRoot, '.aigon', 'install-manifest.json'))) return;

    // Read project config opt-outs (default both layers ON).
    let projectCfg = {};
    try {
        projectCfg = JSON.parse(fs.readFileSync(path.join(repoRoot, '.aigon', 'config.json'), 'utf8'));
    } catch (_) { /* missing config is fine */ }

    // Layer 2: version-change auto-reinstall (silent).
    try {
        const manifest = installManifestLib.readManifest(repoRoot);
        const pkgVersion = require('./package.json').version;
        const autoReinstall = projectCfg.autoReinstallOnVersionChange !== false;
        if (autoReinstall
            && process.env.AIGON_NO_AUTO_REINSTALL !== '1'
            && manifest && manifest.aigonVersion && manifest.aigonVersion !== pkgVersion) {
            const installedAgents = installManifestLib.getInstalledAgents(manifest);
            if (installedAgents.length > 0) {
                const beforeVersion = manifest.aigonVersion;
                // Snapshot hand-edited files BEFORE reinstall and restore
                // AFTER, so install-agent's overwrite path never silently
                // clobbers user edits. Required by the F502 spec's safety
                // contract ("never overwrite without consent").
                const handEdited = installManifestLib.getModifiedFiles(manifest, repoRoot);
                const snapshots = new Map();
                for (const m of handEdited) {
                    try { snapshots.set(m.path, fs.readFileSync(path.join(repoRoot, m.path))); } catch (_) { /* nop */ }
                }
                try {
                    // Silent reinstall: capture stdout, only summarise at the
                    // end so the user sees one line, not the per-agent log.
                    const origWrite = process.stdout.write.bind(process.stdout);
                    process.stdout.write = () => true;
                    try {
                        await commands['install-agent']([...installedAgents]);
                    } finally {
                        process.stdout.write = origWrite;
                    }
                    // Restore hand-edited content. Note: this leaves the
                    // manifest sha != disk sha (the exact state that
                    // doctor --fix-templates flags as HAND_EDITED).
                    for (const [relPath, buf] of snapshots) {
                        try { fs.writeFileSync(path.join(repoRoot, relPath), buf); } catch (_) { /* nop */ }
                    }
                    process.stderr.write(`✓ aigon upgraded ${beforeVersion} → ${pkgVersion} — refreshed ${installedAgents.length} agent${installedAgents.length === 1 ? '' : 's'} (${installedAgents.join(', ')}).\n`);
                    if (snapshots.size > 0) {
                        process.stderr.write(`  Skipped ${snapshots.size} hand-edited file${snapshots.size === 1 ? '' : 's'} (run \`aigon doctor --fix-templates\` to review):\n`);
                        [...snapshots.keys()].slice(0, 5).forEach(p => process.stderr.write(`    - ${p}\n`));
                        if (snapshots.size > 5) process.stderr.write(`    (+${snapshots.size - 5} more)\n`);
                    }
                    return; // L1 already covered by the reinstall
                } catch (_) { /* fall through to L1 */ }
            }
        }
    } catch (_) { /* L2 best-effort */ }

    // Layer 1: warn about stale templates.
    if (projectCfg.installDriftWarnings === false) return;
    try {
        const { byAgent } = driftLib.detectStaleTemplates(repoRoot);
        const lines = driftLib.formatDriftWarning(byAgent);
        for (const line of lines) process.stderr.write(line + '\n');
    } catch (_) { /* never fail the CLI */ }
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

    await maybeRunTemplateDriftLayers(resolvedCommand);

    const isInteractiveEnv = process.stdin.isTTY && process.stdout.isTTY && !process.env.CI && !process.env.AIGON_SKIP_FIRST_RUN;
    if (isInteractiveEnv && !SKIP_FIRST_RUN.has(resolvedCommand) && !firstRunComplete()) {
        try {
            await commands['setup']([]);
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
