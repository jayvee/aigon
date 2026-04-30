'use strict';

const fs = require('fs');
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

const REPO_SCAN_EXCLUDE = new Set([
    '.aigon',
    '.cache',
    '.config',
    '.git',
    '.npm',
    '.Trash',
    'Library',
    'node_modules',
]);

function expandHome(input) {
    const value = String(input || '').trim();
    if (!value) return value;
    return value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
}

function getDefaultRepoScanDir() {
    const candidates = [
        path.join(os.homedir(), 'src'),
        path.join(os.homedir(), 'SRC'),
        path.join(os.homedir(), 'projects'),
        path.join(os.homedir(), 'Projects'),
        os.homedir(),
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || os.homedir();
}

function isDirectGitRepo(candidatePath) {
    try {
        return fs.existsSync(path.join(candidatePath, '.git'));
    } catch (_) {
        return false;
    }
}

function discoverGitRepos(parentDir) {
    const root = path.resolve(expandHome(parentDir));
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (_) {
        return [];
    }

    return entries
        .filter(entry => entry.isDirectory())
        .filter(entry => !REPO_SCAN_EXCLUDE.has(entry.name))
        .map(entry => path.join(root, entry.name))
        .filter(isDirectGitRepo)
        .map(repoPath => path.resolve(repoPath))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function isAigonInitialized(repoPath) {
    return fs.existsSync(path.join(repoPath, '.aigon', 'config.json'))
        || fs.existsSync(path.join(repoPath, 'docs', 'specs'));
}

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
        console.log('aigon setup: non-interactive environment detected. Run with --yes to apply defaults.');
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

        // ── Git identity ─────────────────────────────────────────────────────
        const { execSync } = require('child_process');
        const gitName = (() => { try { return execSync('git config --global user.name', { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { return ''; } })();
        const gitEmail = (() => { try { return execSync('git config --global user.email', { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { return ''; } })();
        if (!gitName || !gitEmail) {
            clack.log.warn('Git identity not set — required for committing spec moves.');
            if (!yesFlag) {
                const name = !gitName ? await clack.text({ message: 'Your name (for git commits):', placeholder: 'Jane Smith' }) : gitName;
                if (clack.isCancel(name)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                const email = !gitEmail ? await clack.text({ message: 'Your email (for git commits):', placeholder: 'jane@example.com' }) : gitEmail;
                if (clack.isCancel(email)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                if (name) execSync(`git config --global user.name ${JSON.stringify(String(name))}`, { stdio: 'ignore' });
                if (email) execSync(`git config --global user.email ${JSON.stringify(String(email))}`, { stdio: 'ignore' });
                clack.log.success('Git identity saved.');
            }
        }

        // ── gh auth ──────────────────────────────────────────────────────────
        const ghAuthed = (() => { try { execSync('gh auth status', { encoding: 'utf8', stdio: 'pipe' }); return true; } catch { return false; } })();
        const ghInstalled = (() => { try { execSync('gh --version', { encoding: 'utf8', stdio: 'pipe' }); return true; } catch { return false; } })();
        if (ghInstalled && !ghAuthed && !yesFlag) {
            const doAuth = await clack.confirm({ message: 'Authenticate with GitHub now? (needed for feature-close and PR integration)', initialValue: true });
            if (clack.isCancel(doAuth)) { clack.cancel('Setup cancelled.'); process.exit(0); }
            if (doAuth) {
                clack.log.info('Launching gh auth login — follow the prompts.');
                spawnSync('gh', ['auth', 'login'], { stdio: 'inherit' });
            }
        }
    }

    // ── Step 2: terminal ─────────────────────────────────────────────────────
    if (shouldRunStep('terminal', startStep, state)) {
        const { selectTerminal, saveTerminalPreference } = require('./terminal');

        const terminalApp = await selectTerminal(yesFlag);
        if (terminalApp) {
            saveTerminalPreference(terminalApp);
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

            // Auth instructions per agent binary — shown after install
            const AUTH_INFO = {
                claude: { hint: 'Type /exit when authenticated to continue setup.', exitNote: '/exit' },
                gemini: { hint: 'Press Ctrl+C when authenticated to continue setup.', exitNote: 'Ctrl+C' },
                codex:  { hint: 'Follow the prompts, then Ctrl+C to continue.', exitNote: 'Ctrl+C' },
            };

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
                    continue;
                }

                // Offer auth for agents that need it
                const binary = agentId.replace('agent:', '');
                const authInfo = AUTH_INFO[binary];
                if (authInfo && !yesFlag) {
                    const doAuth = await clack.confirm({
                        message: `Authenticate ${detector.label} now?`,
                        initialValue: true,
                    });
                    if (clack.isCancel(doAuth)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                    if (doAuth) {
                        clack.log.info(`Launching ${detector.label}. ${authInfo.hint}`);
                        spawnSync(binary, [], { stdio: 'inherit' });
                        clack.log.success(`${detector.label} authentication step complete.`);
                    }
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

            console.log(`Cloning to ${targetDir}…`);
            const cloneResult = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/jayvee/brewboard-seed.git', targetDir], { encoding: 'utf8', stdio: 'inherit' });
            if (cloneResult.status !== 0) {
                clack.log.error(`Clone failed — marking step as skipped`);
                writeStepState('seed-repo', 'skipped');
            } else {
                clack.log.success(`Cloned to ${targetDir}`);

                const aigonCli = process.argv[1];
                const subEnv = { ...process.env, AIGON_SKIP_FIRST_RUN: '1' };

                console.log('📦 Initializing project...');
                const initResult = spawnSync(process.execPath, [aigonCli, 'init'], {
                    cwd: targetDir,
                    stdio: 'inherit',
                    env: subEnv,
                });
                if (initResult.status === 0) {
                    clack.log.success('Project initialized');
                } else {
                    clack.log.warn('aigon init completed with warnings');
                }

                // Re-run install-agent to rewrite hooks with the correct platform
                // paths — the cloned repo may have Mac-specific paths committed.
                console.log('🔧 Installing agent configs for this platform...');
                spawnSync(process.execPath, [aigonCli, 'update'], {
                    cwd: targetDir,
                    stdio: 'inherit',
                    env: subEnv,
                });

                // Register with the dashboard server (safe to call before server starts —
                // aigon server add just writes to the global config, server picks it up on start).
                spawnSync(process.execPath, [aigonCli, 'server', 'add', targetDir], {
                    stdio: 'ignore',
                    env: subEnv,
                });
                clack.log.success(`Registered with dashboard: ${targetDir}`);

                clack.note(`cd ${targetDir}`, 'Next step');
                writeStepState('seed-repo', 'done');
            }
        } else {
            writeStepState('seed-repo', 'skipped');
        }
    }

    // ── Step 5: repos ────────────────────────────────────────────────────────
    if (shouldRunStep('repos', startStep, state)) {
        let selectedRepos = [];
        const envScanDir = process.env.AIGON_ONBOARDING_REPO_SCAN_DIR;
        const envSelectAll = process.env.AIGON_ONBOARDING_REPO_SELECT_ALL === '1';

        if (yesFlag && !envScanDir) {
            writeStepState('repos', 'skipped');
        } else {
            let doScan = !!envScanDir;
            if (!yesFlag && !envScanDir) {
                const confirm = await clack.confirm({
                    message: 'Add existing Git repos to the Aigon dashboard?',
                    initialValue: true,
                });
                if (clack.isCancel(confirm)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                doScan = confirm;
            }

            if (!doScan) {
                writeStepState('repos', 'skipped');
            } else {
                const defaultScanDir = envScanDir ? path.resolve(expandHome(envScanDir)) : getDefaultRepoScanDir();
                let scanDir = defaultScanDir;
                if (!yesFlag) {
                    const dirAnswer = await clack.text({
                        message: 'Scan which folder for Git repos?',
                        placeholder: defaultScanDir,
                        defaultValue: defaultScanDir,
                    });
                    if (clack.isCancel(dirAnswer)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                    scanDir = path.resolve(expandHome(dirAnswer || defaultScanDir));
                }

                const repos = discoverGitRepos(scanDir);
                if (repos.length === 0) {
                    clack.log.info(`No direct Git repos found under ${scanDir}`);
                    writeStepState('repos', 'skipped');
                } else if (yesFlag || envSelectAll) {
                    selectedRepos = repos;
                } else {
                    const choices = await clack.multiselect({
                        message: `Found ${repos.length} Git repo${repos.length === 1 ? '' : 's'} under ${scanDir}. Register with the dashboard?`,
                        options: repos.map(repoPath => ({
                            value: repoPath,
                            label: path.basename(repoPath),
                            hint: repoPath,
                        })),
                        initialValues: repos,
                        required: false,
                    });
                    if (clack.isCancel(choices)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                    selectedRepos = choices || [];
                }

                if (selectedRepos.length === 0) {
                    writeStepState('repos', 'skipped');
                } else {
                    const aigonCli = process.argv[1];
                    const subEnv = { ...process.env, AIGON_SKIP_FIRST_RUN: '1' };
                    let registered = 0;
                    for (const repoPath of selectedRepos) {
                        const result = spawnSync(process.execPath, [aigonCli, 'server', 'add', repoPath], {
                            stdio: 'ignore',
                            env: subEnv,
                        });
                        if (result.status === 0) registered++;
                    }

                    const uninitialized = selectedRepos.filter(repoPath => !isAigonInitialized(repoPath));
                    let doInit = false;
                    if (uninitialized.length > 0 && !yesFlag) {
                        const initConfirm = await clack.confirm({
                            message: `${uninitialized.length} selected repo${uninitialized.length === 1 ? ' is' : 's are'} not initialized for Aigon. Initialize now?`,
                            initialValue: false,
                        });
                        if (clack.isCancel(initConfirm)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                        doInit = initConfirm;
                    }
                    if (doInit) {
                        for (const repoPath of uninitialized) {
                            clack.log.info(`Initializing ${path.basename(repoPath)}…`);
                            spawnSync(process.execPath, [aigonCli, 'init'], {
                                cwd: repoPath,
                                stdio: 'inherit',
                                env: subEnv,
                            });
                        }
                    }

                    clack.log.success(`Registered ${registered} repo${registered === 1 ? '' : 's'} with the dashboard.`);
                    writeStepState('repos', registered > 0 ? 'done' : 'skipped');
                }
            }
        }
    }

    // ── Step 6: server ───────────────────────────────────────────────────────
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
            const logPath = require('path').join(os.homedir(), '.aigon', 'dashboard.log');
            const { openSync } = require('fs');
            const logFd = openSync(logPath, 'a');
            spawn(process.execPath, [aigonCli, 'server', 'start'], {
                stdio: ['ignore', logFd, logFd],
                detached: true,
            }).unref();
            // Brief pause so the server can bind before registering repos
            await new Promise(r => setTimeout(r, 2000));

            clack.log.success('Dashboard started — open http://localhost:4100 in your browser.');
            clack.log.info(`Logs: ${logPath}`);
            writeStepState('server', 'done');
        } else {
            writeStepState('server', 'skipped');
        }
    }

    // ── Step 7: demo ─────────────────────────────────────────────────────────
    if (shouldRunStep('demo', startStep, state)) {
        const brewboardPath = path.join(os.homedir(), 'src', 'brewboard');
        const backlogDir = path.join(brewboardPath, 'docs', 'specs', 'features', '02-backlog');

        if (yesFlag) {
            writeStepState('demo', 'skipped');
        } else if (state.steps && state.steps['seed-repo'] === 'skipped') {
            clack.log.info('Skipping demo — Brewboard not available');
            writeStepState('demo', 'skipped');
        } else if (!fs.existsSync(brewboardPath) || !fs.existsSync(backlogDir)) {
            clack.log.info('Skipping demo — Brewboard not available');
            writeStepState('demo', 'skipped');
        } else {
            const claudeAvailable = (() => {
                try {
                    const result = spawnSync('claude', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
                    return result.status === 0;
                } catch {
                    return false;
                }
            })();

            if (!claudeAvailable) {
                clack.log.info('Skipping demo — no agent CLI installed');
                writeStepState('demo', 'skipped');
            } else {
                const confirm = await clack.confirm({
                    message: 'Run a demo feature on Brewboard to see Aigon in action? (~2 min)',
                    initialValue: false,
                });
                if (clack.isCancel(confirm)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                if (!confirm) {
                    writeStepState('demo', 'skipped');
                } else {
                    let files;
                    try {
                        files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
                    } catch {
                        files = [];
                    }
                    if (files.length === 0) {
                        clack.log.info('Skipping demo — no backlog features in Brewboard');
                        writeStepState('demo', 'skipped');
                    } else {
                        const firstSpec = files[0];
                        const match = firstSpec.match(/feature-(\d+)/);
                        if (!match) {
                            clack.log.warn('Demo start failed — continuing setup.');
                            writeStepState('demo', 'skipped');
                        } else {
                            const featureId = match[1];
                            const aigonCli = process.argv[1];
                            clack.log.info('Starting demo feature… watch the terminal open.');
                            const result = spawnSync(process.execPath, [aigonCli, 'feature-start', featureId, 'cc'], {
                                cwd: brewboardPath,
                                stdio: 'inherit',
                                env: process.env,
                            });
                            if (result.status === 0) {
                                clack.log.success('Demo feature running!');
                                clack.note(`Watch it: cd ~/src/brewboard && aigon feature-open ${featureId}`, 'Demo');
                                writeStepState('demo', 'done');
                            } else {
                                clack.log.warn('Demo start failed — continuing setup.');
                                writeStepState('demo', 'skipped');
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Step 7: vault ────────────────────────────────────────────────────────
    // Vault setup requires the backup engine, which moved to @aigon/pro with
    // feature 236. Skip the step when Pro is not installed; otherwise let Pro
    // drive the configuration.
    if (shouldRunStep('vault', startStep, state)) {
        const { isProAvailable, getPro } = require('../pro');
        const backup = isProAvailable() && getPro() && getPro().backup ? getPro().backup : null;
        if (!backup) {
            clack.note('Vault backup is a Pro feature — skipping setup.', 'Backup');
            writeStepState('vault', 'skipped');
        } else {
        const existingRemote = backup.getRemote();
        if (existingRemote) {
            clack.note(`Already configured: ${existingRemote}`, 'Backup');
            writeStepState('vault', 'done');
        } else {
            let doVault = false;
            if (!yesFlag) {
                const ans = await clack.confirm({
                    message: 'Set up aigon-vault to back up your data? (Recommended)',
                    initialValue: true,
                });
                if (clack.isCancel(ans)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                doVault = ans;
            }
            if (!doVault) {
                clack.note('You can set this up later with: aigon backup configure', 'Backup skipped');
                writeStepState('vault', 'skipped');
            } else {
                const { execSync } = require('child_process');
                const ghAvailable = (() => { try { execSync('gh --version', { stdio: 'pipe' }); return true; } catch { return false; } })();
                const ghAuthed = ghAvailable && (() => { try { execSync('gh auth status', { stdio: 'pipe' }); return true; } catch { return false; } })();
                let remote = null;
                if (ghAuthed) {
                    const useGh = await clack.confirm({
                        message: 'Create a private aigon-vault repo on GitHub now?',
                        initialValue: true,
                    });
                    if (clack.isCancel(useGh)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                    if (useGh) {
                        const nameAns = await clack.text({
                            message: 'Repo name',
                            placeholder: 'aigon-vault',
                            defaultValue: 'aigon-vault',
                        });
                        if (clack.isCancel(nameAns)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                        const name = String(nameAns || 'aigon-vault').trim() || 'aigon-vault';
                        const spin = clack.spinner();
                        spin.start(`Creating ${name} on GitHub…`);
                        try {
                            remote = backup.createVaultOnGitHub(name);
                            spin.stop(`✅ Created ${remote}`);
                        } catch (e) {
                            spin.stop(`❌ ${e.message}`);
                        }
                    }
                }
                if (!remote) {
                    const url = await clack.text({
                        message: 'Git URL for the vault repo (leave empty to skip)',
                        placeholder: 'git@github.com:you/aigon-vault.git',
                    });
                    if (clack.isCancel(url)) { clack.cancel('Setup cancelled.'); process.exit(0); }
                    remote = url ? String(url).trim() : null;
                }
                if (!remote) {
                    clack.note('You can set this up later with: aigon backup configure', 'Backup skipped');
                    writeStepState('vault', 'skipped');
                } else {
                    try {
                        backup.configure(remote);
                        const spin = clack.spinner();
                        spin.start('Running initial backup push…');
                        try {
                            const result = backup.push();
                            spin.stop(`✅ Initial push: ${result.fileCount || 0} files`);
                        } catch (e) {
                            spin.stop(`⚠️  Initial push failed: ${e.message}`);
                        }
                        writeStepState('vault', 'done');
                    } catch (e) {
                        clack.log.warn(`Vault configure failed: ${e.message}`);
                        writeStepState('vault', 'skipped');
                    }
                }
            }
        }
        }
    }

    // ── Step 8: done ─────────────────────────────────────────────────────────
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
    clack.outro('✅ All done! Run `aigon board` to see your project, or open http://localhost:4100 in your browser.');
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
