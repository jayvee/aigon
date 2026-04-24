'use strict';

const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const clack = require('@clack/prompts');
const {
    readOnboardingState,
    writeStepState,
    markComplete,
    isOnboardingComplete,
    getFirstIncompleteStep,
    STEP_IDS,
} = require('./state');

async function runWizard(args = []) {
    const yesFlag = args.includes('--yes');
    const resumeFlag = args.includes('--resume');

    process.on('SIGINT', () => {
        clack.cancel('Setup cancelled.');
        process.exit(0);
    });

    // Non-interactive guard
    const isCI = !!(process.env.CI);
    const isTTY = process.stdin.isTTY && process.stdout.isTTY;
    if ((!isTTY || isCI) && !yesFlag) {
        console.log('aigon onboarding: non-interactive environment detected. Run with --yes to apply defaults.');
        return;
    }

    const state = readOnboardingState();

    // Already complete — print summary and exit
    if (isOnboardingComplete(state) && !resumeFlag) {
        clack.intro('Aigon Setup');
        clack.note(
            STEP_IDS.map(id => `${state.steps[id] === 'done' ? '✅' : '⏭️ '} ${id}`).join('\n'),
            'Setup already complete'
        );
        clack.outro('Run with --resume to re-run skipped steps, or aigon global-setup --force to reconfigure.');
        return;
    }

    // Determine start step
    const startStep = resumeFlag ? (getFirstIncompleteStep(state) || STEP_IDS[0]) : STEP_IDS[0];
    if (resumeFlag && !getFirstIncompleteStep(state)) {
        clack.intro('Aigon Setup');
        clack.note('All steps are already complete.', 'Nothing to resume');
        clack.outro('Done!');
        return;
    }

    clack.intro('🚀 Aigon Setup Wizard');

    // ── Step 1: prereqs ─────────────────────────────────────────────────────
    if (shouldRunStep('prereqs', startStep, state)) {
        const { getDetectors } = require('./detectors');
        const detectors = getDetectors();
        let hardFail = false;

        for (const detector of detectors) {
            const spin = clack.spinner();
            spin.start(`Checking ${detector.label}…`);
            const result = await detector.check();
            if (result.found) {
                spin.stop(`✅ ${detector.label}${result.version ? ` (${result.version})` : ''}`);
            } else if (detector.required) {
                const installResult = await detector.install();
                const remediation = installResult.output || 'Manual install required.';
                spin.stop(`❌ ${detector.label} — required but not found`);
                clack.note(remediation, `Install ${detector.label}`);
                hardFail = true;
            } else {
                spin.stop(`⚠️  ${detector.label} — not found (optional)`);
                if (!yesFlag) {
                    const shouldInstall = await clack.confirm({
                        message: `Install ${detector.label} now?`,
                        initialValue: false,
                    });
                    if (clack.isCancel(shouldInstall)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                    if (shouldInstall) {
                        const installSpin = clack.spinner();
                        installSpin.start(`Installing ${detector.label}…`);
                        const installResult = await detector.install();
                        installSpin.stop(installResult.ok ? `✅ Installed ${detector.label}` : `❌ Install failed: ${installResult.output}`);
                    }
                }
            }
        }

        if (hardFail) {
            clack.cancel('Setup aborted: required dependencies are missing. See remediation steps above.');
            process.exit(1);
        }

        writeStepState('prereqs', 'done');
    }

    // ── Step 2: terminal ─────────────────────────────────────────────────────
    if (shouldRunStep('terminal', startStep, state)) {
        const cfg = require('../config');
        const { TERMINAL_CONFIG_MIGRATION_VERSION } = require('../global-config-migration');

        if (process.platform === 'darwin') {
            const fs = require('fs');
            let terminalApp;
            if (yesFlag) {
                terminalApp = 'iterm2';
            } else {
                const choice = await clack.select({
                    message: 'Which terminal app do you use for agent sessions?',
                    options: [
                        { value: 'iterm2', label: 'iTerm2' },
                        { value: 'apple-terminal', label: 'Apple Terminal (built-in)' },
                        { value: 'warp', label: 'Warp' },
                    ],
                    initialValue: 'iterm2',
                });
                if (clack.isCancel(choice)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                terminalApp = choice;
            }

            let rawConfig = {};
            if (fs.existsSync(cfg.GLOBAL_CONFIG_PATH)) {
                try { rawConfig = JSON.parse(fs.readFileSync(cfg.GLOBAL_CONFIG_PATH, 'utf8')); } catch (_) {}
            }
            const { TERMINAL_CONFIG_MIGRATION_VERSION } = require('../global-config-migration');
            cfg.saveGlobalConfig(Object.assign({}, rawConfig, {
                schemaVersion: TERMINAL_CONFIG_MIGRATION_VERSION,
                terminalApp,
                repos: rawConfig.repos || [],
            }));
            clack.note(`Set terminal: ${terminalApp}`, 'Terminal preference saved');
        }
        // Linux: skip terminal step silently

        writeStepState('terminal', 'done');
    }

    // ── Step 3: agents ───────────────────────────────────────────────────────
    if (shouldRunStep('agents', startStep, state)) {
        const { getAgentDetectors } = require('./detectors');
        const agentDetectors = getAgentDetectors();

        if (agentDetectors.length === 0) {
            clack.note('No agents registered.', 'Agents');
            writeStepState('agents', 'skipped');
        } else {
            let selectedAgents = [];
            if (yesFlag) {
                selectedAgents = []; // opt-in only — don't auto-install
            } else {
                const choices = await clack.multiselect({
                    message: 'Which AI agents do you want to install?',
                    options: agentDetectors.map(d => ({ value: d.id, label: d.label })),
                    required: false,
                });
                if (clack.isCancel(choices)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                selectedAgents = choices || [];
            }

            for (const agentId of selectedAgents) {
                const detector = agentDetectors.find(d => d.id === agentId);
                if (!detector) continue;
                const spin = clack.spinner();
                spin.start(`Installing ${detector.label}…`);
                const result = await detector.install();
                if (result.ok) {
                    const verified = await detector.verify();
                    spin.stop(verified.found ? `✅ ${detector.label} installed` : `⚠️  ${detector.label} install succeeded but verify failed`);
                } else {
                    spin.stop(`❌ ${detector.label}: ${result.output}`);
                }
            }

            writeStepState('agents', 'done');
        }
    }

    // ── Step 4: seed-repo ────────────────────────────────────────────────────
    if (shouldRunStep('seed-repo', startStep, state)) {
        let doClone = false;
        if (!yesFlag) {
            const confirm = await clack.confirm({
                message: 'Clone the brewboard seed repo for a ready-to-use Aigon project?',
                initialValue: false,
            });
            if (clack.isCancel(confirm)) { clack.cancel('Setup cancelled.'); process.exit(0); }
            doClone = confirm;
        }

        if (doClone) {
            const defaultDir = path.join(os.homedir(), 'src', 'brewboard');
            const dirAnswer = await clack.text({
                message: 'Clone to which directory?',
                placeholder: defaultDir,
                defaultValue: defaultDir,
            });
            if (clack.isCancel(dirAnswer)) { clack.cancel('Setup cancelled.'); process.exit(0); }
            const targetDir = path.resolve((dirAnswer || '').trim() || defaultDir);

            const cloneSpin = clack.spinner();
            cloneSpin.start(`Cloning to ${targetDir}…`);
            const cloneResult = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/jayvee/brewboard-seed.git', targetDir], { encoding: 'utf8', stdio: 'pipe' });
            if (cloneResult.status !== 0) {
                cloneSpin.stop(`❌ Clone failed — marking step as skipped`);
                writeStepState('seed-repo', 'skipped');
            } else {
                cloneSpin.stop(`✅ Cloned to ${targetDir}`);

                const aigonCli = process.argv[1];
                const initSpin = clack.spinner();
                initSpin.start('Running aigon init…');
                const initResult = spawnSync(process.execPath, [aigonCli, 'init'], { cwd: targetDir, stdio: 'inherit' });
                initSpin.stop(initResult.status === 0 ? '✅ Project initialized' : '⚠️  aigon init completed with warnings');

                clack.note(`cd ${targetDir}`, 'Next step');
                writeStepState('seed-repo', 'done');
            }
        } else {
            writeStepState('seed-repo', 'skipped');
        }
    }

    // ── Step 5: server ───────────────────────────────────────────────────────
    if (shouldRunStep('server', startStep, state)) {
        let doStart = false;
        if (!yesFlag) {
            const confirm = await clack.confirm({
                message: 'Start the Aigon dashboard server now?',
                initialValue: false,
            });
            if (clack.isCancel(confirm)) { clack.cancel('Setup cancelled.'); process.exit(0); }
            doStart = confirm;
        }

        if (doStart) {
            const aigonCli = process.argv[1];
            const { spawn } = require('child_process');
            spawn(process.execPath, [aigonCli, 'server', 'start'], { stdio: 'inherit', detached: true }).unref();
            clack.note('Dashboard starting — open http://localhost:4100 in your browser.', 'Server');
            writeStepState('server', 'done');
        } else {
            writeStepState('server', 'skipped');
        }
    }

    // ── Step 6: done ─────────────────────────────────────────────────────────
    markComplete();

    // Set onboarded: true in global config
    const cfg = require('../config');
    const { existsSync, readFileSync } = require('fs');
    let rawConfig = {};
    if (existsSync(cfg.GLOBAL_CONFIG_PATH)) {
        try { rawConfig = JSON.parse(readFileSync(cfg.GLOBAL_CONFIG_PATH, 'utf8')); } catch (_) {}
    }
    cfg.saveGlobalConfig(Object.assign({}, rawConfig, {
        onboarded: true,
        repos: rawConfig.repos || [],
    }));

    const finalState = readOnboardingState();
    const summary = STEP_IDS.map(id => {
        const status = finalState.steps && finalState.steps[id];
        return `${status === 'done' ? '✅' : '⏭️ '} ${id}${status === 'skipped' ? ' (skipped)' : ''}`;
    }).join('\n');
    clack.note(summary, 'Setup complete');
    clack.outro('You\'re ready to use Aigon! Run `aigon help` to see all commands.');
}

function shouldRunStep(stepId, startStep, state) {
    const idx = STEP_IDS.indexOf(stepId);
    const startIdx = STEP_IDS.indexOf(startStep);
    if (idx < startIdx) return false; // before resume point
    const stepState = state && state.steps && state.steps[stepId];
    if (stepState === 'done' || stepState === 'skipped') return false;
    return true;
}

module.exports = { runWizard };
