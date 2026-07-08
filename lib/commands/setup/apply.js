'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { loadProjectConfig } = require('../../config');
const gitignoreAndHooks = require('./gitignore-and-hooks');
const agentTrust = require('./agent-trust');
const { runInitBootstrap, printFirstTimeNextStepHint } = require('./init-bootstrap');

const {
    ensureLocalGitExclude,
    getStandardLocalGitExcludeEntries,
} = gitignoreAndHooks;

const {
    findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots,
} = agentTrust;

module.exports = function applyCommand(ctx, getCommand) {
    const u = ctx.utils;
    const versionLib = ctx.version;
    const {
        PATHS,
        SPECS_ROOT,
        MARKER_START,
        MARKER_END,
        COMMAND_ALIASES,
        COMMAND_ALIAS_REVERSE,
        showPortSummary,
        getActiveProfile,
        getAvailableAgents,
        loadAgentConfig,
        buildAgentAliasMap,
        resolveAgentCommands,
        readTemplate,
        readGenericTemplate,
        processTemplate,
        safeWrite,
        safeWriteWithStatus,
        upsertMarkedContent,
        extractDescription,
        formatCommandOutput,
        getProfilePlaceholders,
        computeInstructionsConfigHash,
        computeAppliedDigest,
        computeAppliedDigestDetailed,
        readAppliedDigest,
        writeAppliedDigest,
        buildDriftSummary,
        removeDeprecatedCommands,
        removeDeprecatedSkillDirs,
        renderSkillMd,
        getStatusRaw,
    } = u;
    const {
        getAigonVersion,
        getInstalledVersion,
        setInstalledVersion,
        compareVersions,
        getChangelogEntriesSince,
        checkAigonCliOrigin,
    } = versionLib;
    const { ensureBoardMapInGitignore } = ctx.board;

    return async (args) => {
            if (args.includes('--pull')) {
                console.error('Error: --pull is not supported.');
                console.error('       Upgrade aigon with: npm update -g @senlabsai/aigon');
                process.exit(1);
            }

            // F500: --all iterates the global repo registry, running `aigon apply`
            // per known repo sequentially. Repos already at the current digest
            // are skipped (no-op fast path); missing/non-aigon paths are pruned
            // silently from the read.
            if (args.includes('--all')) {
                const { readConductorReposFromGlobalConfig } = require('../../config');
                const { computeAppliedDigest, readAppliedDigest } = require('../../profile-placeholders');
                const passthroughArgs = args.filter(a => a !== '--all');
                const aigonBin = path.join(__dirname, '..', '..', '..', 'aigon-cli.js');
                const knownRepos = readConductorReposFromGlobalConfig()
                    .map(r => path.resolve(r))
                    .filter(r => fs.existsSync(path.join(r, '.aigon')))
                    .filter(r => !fs.existsSync(path.join(r, '.aigon', 'worktree.json')));

                if (knownRepos.length === 0) {
                    console.log('ℹ️  No registered repos found in ~/.aigon/config.json.');
                    console.log('   Run `aigon apply` from each repo, or `aigon server repos add <path>`.');
                    return;
                }

                const results = [];
                for (let i = 0; i < knownRepos.length; i++) {
                    const repo = knownRepos[i];
                    const label = `[${i + 1}/${knownRepos.length}] ${repo}`;

                    // Fast path: skip when the current digest already matches the stored one.
                    let skipped = false;
                    try {
                        const stored = readAppliedDigest(repo);
                        if (stored && stored.digest && stored.digest === computeAppliedDigest(repo)) {
                            skipped = true;
                        }
                    } catch (_) { /* fall through to apply */ }

                    if (skipped) {
                        console.log(`${label}: skipped (current)`);
                        results.push({ repo, status: 'skipped', failed: false });
                        continue;
                    }

                    console.log(`\n${label}: applying…`);
                    const child = spawnSync(process.execPath, [aigonBin, 'apply', ...passthroughArgs], {
                        cwd: repo,
                        stdio: 'inherit',
                        env: process.env,
                    });
                    const failed = child.status !== 0;
                    console.log(`${label}: ${failed ? 'failed' : 'ok'}`);
                    results.push({ repo, status: failed ? 'failed' : 'ok', failed });
                }

                const ok = results.filter(r => r.status === 'ok').length;
                const skipped = results.filter(r => r.status === 'skipped').length;
                const failed = results.filter(r => r.failed).length;
                console.log(`\n📦 apply --all summary: ${ok} applied, ${skipped} skipped, ${failed} failed (${results.length} total).`);
                if (failed > 0) {
                    results.filter(r => r.failed).forEach(r => console.log(`   ✗ ${r.repo}`));
                    process.exit(1);
                }
                return;
            }

            // First-time bootstrap: if .aigon/ doesn't exist yet, run init logic
            // before the normal apply flow.
            const _applyCwd = process.cwd();
            const _aigonDir = path.join(_applyCwd, '.aigon');
            const _isWorktree = fs.existsSync(path.join(_aigonDir, 'worktree.json'));
            const _isGitRepo = fs.existsSync(path.join(_applyCwd, '.git')) || _isWorktree;

            if (!_isGitRepo) {
                console.error('❌ Not a Git repository. Run `git init` first, then re-run `aigon apply`.');
                process.exit(1);
            }

            const _isFirstTime = !fs.existsSync(_aigonDir) && !_isWorktree;
            if (_isFirstTime) {
                console.log('✨ First-time setup: bringing Aigon into this repo…');
                runInitBootstrap(ctx);
            }

            // F500: register this repo in the global repos array so `apply --all`
            // and the dashboard's multi-repo views see it without needing the
            // server to have been started first. Worktrees are skipped (they
            // never write `.aigon/version` per F497; registering them would
            // pollute the registry through feature-close cycles).
            try {
                const cwd = process.cwd();
                const worktreeMarker = path.join(cwd, '.aigon', 'worktree.json');
                if (!fs.existsSync(worktreeMarker)) {
                    const { autoRegisterRepoIfNeeded } = require('../infra');
                    autoRegisterRepoIfNeeded(cwd);
                }
            } catch (_) { /* non-fatal */ }

            // Check if behind origin and advise
            const { behind, error: originError } = checkAigonCliOrigin();
            if (behind > 0) {
                console.log(`⬆️  Aigon CLI is ${behind} commit${behind === 1 ? '' : 's'} behind origin. Run \`npm update -g @senlabsai/aigon\` to upgrade the CLI first.\n`);
            } else if (originError) {
                console.warn(`⚠️  Could not check for a CLI upgrade from origin: ${originError}`);
                console.warn('   Continuing with project sync only.\n');
            }

            // Re-read version
            const currentVersion = getAigonVersion();
            const installedVersion = getInstalledVersion();

            console.log("📦 Project sync: updating templates and agent configs...");
            if (installedVersion && currentVersion) {
                console.log(`   ${installedVersion} → ${currentVersion}`);
            } else if (currentVersion) {
                console.log(`   Installing version ${currentVersion}`);
            }
            console.log();

            // Show changelog entries since last installed version
            if (installedVersion && currentVersion && compareVersions(currentVersion, installedVersion) > 0) {
                const entries = getChangelogEntriesSince(installedVersion);
                if (entries.length > 0) {
                    console.log(`📋 What's new since ${installedVersion}:\n`);
                    entries.forEach(entry => {
                        console.log(`   ## ${entry.version}`);
                        // Show just the section headers and first items, not full body
                        const lines = entry.body.split('\n').filter(l => l.trim());
                        lines.slice(0, 6).forEach(line => {
                            console.log(`   ${line}`);
                        });
                        if (lines.length > 6) {
                            console.log(`   ... (${lines.length - 6} more lines)`);
                        }
                        console.log();
                    });
                }
            }

            try {
                // Track changed files for summary
                const changes = { created: [], updated: [], unchanged: [] };
                const noCommit = args.includes('--no-commit');

                // 1. Detect installed agents from project artifacts
                const _agentRegistry = require('../../agent-registry');
                const installedAgents = [];
                getAvailableAgents().forEach(agentId => {
                    const config = loadAgentConfig(agentId);
                    if (!config) return;

                    const docsAgentPath = config.agentFile
                        ? path.join(process.cwd(), 'docs', 'agents', config.agentFile)
                        : null;
                    const localCommandDir = (config.output && !config.output.global && config.output.commandDir)
                        ? path.join(process.cwd(), config.output.commandDir)
                        : null;
                    const rootFilePath = config.rootFile ? path.join(process.cwd(), config.rootFile) : null;
                    const extras = config.extras || {};
                    const settingsPath = extras.settings?.enabled ? path.join(process.cwd(), extras.settings.path) : null;
                    const configPath = extras.config?.enabled ? path.join(process.cwd(), extras.config.path) : null;

                    // Check legacy detection paths from agent config
                    const legacy = _agentRegistry.getLegacyPaths(agentId);
                    const hasLegacyFile = Object.values(legacy).some(relPath =>
                        relPath && fs.existsSync(path.join(process.cwd(), relPath))
                    );

                    const isInstalled =
                        (rootFilePath && fs.existsSync(rootFilePath)) ||
                        (docsAgentPath && fs.existsSync(docsAgentPath)) ||
                        (localCommandDir && fs.existsSync(localCommandDir)) ||
                        (settingsPath && fs.existsSync(settingsPath)) ||
                        (configPath && fs.existsSync(configPath)) ||
                        hasLegacyFile;

                    if (isInstalled) {
                        installedAgents.push(agentId);
                    }
                });

                const uniqueInstalledAgents = [...new Set(installedAgents)];

                // 1.5 Migration notices for legacy root files
                const allLegacyFiles = [];
                getAvailableAgents().forEach(agentId => {
                    const legacy = _agentRegistry.getLegacyPaths(agentId);
                    for (const [key, relPath] of Object.entries(legacy)) {
                        if (relPath && fs.existsSync(path.join(process.cwd(), relPath))) {
                            allLegacyFiles.push(relPath);
                        }
                    }
                });
                if (allLegacyFiles.length > 0) {
                    console.log(`⚠️  Migration notice: AGENTS.md is now the shared root instruction file.`);
                    for (const legacyFile of allLegacyFiles) {
                        console.log(`   - Detected legacy ${legacyFile}. New installs no longer generate this file.`);
                    }
                    console.log(`   - Legacy files are not auto-deleted. Review and remove them manually when ready.\n`);
                }

                // 2. Ensure spec folder structure exists (same as init)
                const createDirs = (root, folders) => {
                    folders.forEach(f => {
                        const p = path.join(root, f);
                        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
                    });
                };
                createDirs(PATHS.research.root, PATHS.research.folders);
                createDirs(PATHS.features.root, PATHS.features.folders);
                createDirs(PATHS.feedback.root, PATHS.feedback.folders);
                const featLogs = path.join(PATHS.features.root, 'logs');
                if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
                if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
                if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
                console.log(`✅ Verified: docs/specs directory structure`);

                // 3. Update vendored aigon docs in .aigon/docs/
                //    Iterates templates/docs/ so newly added template files are
                //    picked up automatically. The consumer's `docs/` folder is
                //    never touched (F421).
                const lightDirectivesUpdate = require('../../profile-placeholders').resolveInstructionDirectives(
                    loadProjectConfig(process.cwd())?.instructions
                );
                const isLightRigorUpdate = lightDirectivesUpdate.testing === 'skip' && lightDirectivesUpdate.logging === 'skip';
                const { stripLightOptionalBlocks: stripLightOptionalBlocksUpdate } = require('../../templates');
                const docsTemplateDirUpdate = path.join(u.TEMPLATES_ROOT, 'docs');
                if (fs.existsSync(docsTemplateDirUpdate)) {
                    const docFilesUpdate = fs.readdirSync(docsTemplateDirUpdate).filter(f => f.endsWith('.md'));
                    docFilesUpdate.forEach(file => {
                        const docRaw = readTemplate(`docs/${file}`);
                        const docContent = stripLightOptionalBlocksUpdate(docRaw, isLightRigorUpdate);
                        const docPath = path.join(process.cwd(), '.aigon', 'docs', file);
                        const docStatus = safeWriteWithStatus(docPath, docContent);
                        changes[docStatus].push(`.aigon/docs/${file}`);
                        if (docStatus !== 'unchanged') {
                            console.log(`✅ ${docStatus.charAt(0).toUpperCase() + docStatus.slice(1)}: .aigon/docs/${file}`);
                        }
                    });
                }

                // 4. Install/update spec templates
                const specsTemplatesDir = path.join(process.cwd(), 'docs', 'specs', 'templates');
                if (!fs.existsSync(specsTemplatesDir)) {
                    fs.mkdirSync(specsTemplatesDir, { recursive: true });
                }

                const featureTemplate = readTemplate('specs/feature-template.md');
                const featureStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'feature-template.md'), featureTemplate);
                changes[featureStatus].push('docs/specs/templates/feature-template.md');
                if (featureStatus !== 'unchanged') {
                    console.log(`✅ ${featureStatus.charAt(0).toUpperCase() + featureStatus.slice(1)}: docs/specs/templates/feature-template.md`);
                }

                const researchTemplate = readTemplate('specs/research-template.md');
                const researchStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'research-template.md'), researchTemplate);
                changes[researchStatus].push('docs/specs/templates/research-template.md');
                if (researchStatus !== 'unchanged') {
                    console.log(`✅ ${researchStatus.charAt(0).toUpperCase() + researchStatus.slice(1)}: docs/specs/templates/research-template.md`);
                }

                const feedbackTemplate = readTemplate('specs/feedback-template.md');
                const feedbackStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'feedback-template.md'), feedbackTemplate);
                changes[feedbackStatus].push('docs/specs/templates/feedback-template.md');
                if (feedbackStatus !== 'unchanged') {
                    console.log(`✅ ${feedbackStatus.charAt(0).toUpperCase() + feedbackStatus.slice(1)}: docs/specs/templates/feedback-template.md`);
                }

                // 5. Re-run install-agent for detected agents
                if (uniqueInstalledAgents.length > 0) {
                    console.log(`\n📦 Re-installing agents: ${uniqueInstalledAgents.join(', ')}`);
                    await getCommand('install-agent')(uniqueInstalledAgents);
                } else {
                    console.log(`\nℹ️  No agents detected. Run 'aigon install-agent <agent-id>' to install.`);
                }

                try {
                    const applyRepoRoot = process.cwd();
                    ensureLocalGitExclude(applyRepoRoot, getStandardLocalGitExcludeEntries(applyRepoRoot));
                } catch (_) { /* best-effort */ }

                // 6. Update installed version
                if (currentVersion) {
                    setInstalledVersion(currentVersion);
                }

                // 6.5. Write applied-digest (content-based drift detection, F497) and legacy config-hash.
                // Skip in worktrees — same reason as setInstalledVersion.
                try {
                    const detailed = computeAppliedDigestDetailed(process.cwd());
                    writeAppliedDigest(process.cwd(), detailed);
                    // Keep legacy config-hash for any tools that still read it
                    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
                    if (!fs.existsSync(worktreeMarker)) {
                        const configHash = computeInstructionsConfigHash();
                        safeWrite(path.join(process.cwd(), '.aigon', 'config-hash'), configHash);
                    }
                } catch (e) {
                    // Non-fatal
                }

                // 7. Restart server if running (only when updating from the aigon repo itself)
                const aigonRoot = path.resolve(__dirname, '..', '..', '..');
                const isAigonRepo = path.resolve(process.cwd()) === aigonRoot;
                if (isAigonRepo) {
                    // Resolve the configured server port up-front so both restart
                    // paths can verify health afterwards. The port is centralised
                    // in `lib/config.js`; falls back gracefully if config is unreadable.
                    let configuredServerPort = null;
                    try {
                        const { getConfiguredServerPort } = require('../../config');
                        configuredServerPort = getConfiguredServerPort();
                    } catch (_) { /* non-fatal */ }
                    const { waitForServerHealthy } = require('../../server-runtime');
                    const verifyHealth = async (port) => {
                        if (!port) return; // can't verify without a port
                        const ok = await waitForServerHealthy(port, 5000);
                        if (ok) {
                            console.log(`✅ Server restarted and responding on port ${port}`);
                        } else {
                            console.log(`⚠️  Server was restarted but did not respond within 5s — check \`aigon server status\` and logs at ~/.aigon/logs/`);
                        }
                    };

                    try {
                        const { isServiceInstalled, restartService } = require('../../supervisor-service');
                        if (isServiceInstalled()) {
                            // Delegate to launchd/systemd — avoids spawning a
                            // duplicate process that races with KeepAlive.
                            restartService();
                            console.log('\n🔄 Server restarted via system service.');
                            await verifyHealth(configuredServerPort);
                        } else {
                            // No persistent service — kill and respawn manually.
                            const { isPortInUseSync } = require('../../proxy');
                            let restarted = false;
                            // Kill any process holding the server port
                            if (isPortInUseSync(configuredServerPort)) {
                                try {
                                    const pids = execSync(`lsof -ti tcp:${configuredServerPort}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                                    pids.split('\n').filter(Boolean).forEach(p => {
                                        try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch (_) {}
                                    });
                                    // Wait for port to be released
                                    for (let i = 0; i < 20; i++) {
                                        if (!isPortInUseSync(configuredServerPort)) break;
                                        execSync('sleep 0.1', { stdio: 'pipe' });
                                    }
                                    restarted = true;
                                } catch (e) { /* ignore kill errors */ }
                            }
                            if (restarted) {
                                const aigonBin = path.join(aigonRoot, 'aigon-cli.js');
                                const { spawn } = require('child_process');
                                const child = spawn(process.execPath, [aigonBin, 'server', 'start'], {
                                    detached: true,
                                    stdio: 'ignore',
                                    cwd: aigonRoot,
                                });
                                child.unref();
                                console.log(`\n🔄 Server restarted (PID ${child.pid})`);
                                await verifyHealth(configuredServerPort);
                            }
                        }
                    } catch (e) {
                        // Non-fatal — server restart is best-effort
                    }
                }

                // Summary - version changed OR file changes means we updated
                const versionChanged = installedVersion && currentVersion && installedVersion !== currentVersion;
                let hasFileChanges = false;
                // Only stage paths updated by this `apply` run (aigon-managed artifacts).
                // NEVER stage docs/specs/features/ or docs/specs/research-topics/ —
                // those contain user spec files that can be dirty for unrelated reasons.
                // Bug history: broad `git add docs/` once swept a stale spec rename
                // into an auto-commit, moving a done feature back to backlog.
                const aigonPaths = [
                    '.aigon/docs/',
                    'docs/specs/templates/',
                    '.agents/',
                    '.claude/',
                    '.cursor/',
                    '.codex/',
                    '.gemini/',
                    '.aigon/version',
                ];
                const aigonPathsStr = aigonPaths.join(' ');
                try {
                    const gitStatus = execSync(`git status --porcelain ${aigonPathsStr} 2>/dev/null`, { encoding: 'utf8' });
                    hasFileChanges = gitStatus.trim().length > 0;
                } catch (e) {
                    // Not a git repo - can't determine
                }

                // 8. Bootstrap workflow state for entities that don't have it yet.
                // Most common cause: a freshly-cloned seed repo (e.g. brewboard-seed)
                // ships `.aigon/` but excludes `.aigon/workflows/`, so first apply
                // must seed engine snapshots from the folder layout. Idempotent:
                // does nothing when every entity already has a snapshot.
                try {
                    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
                    if (!fs.existsSync(worktreeMarker)) {
                        const { features: missingF, research: missingR } = findEntitiesMissingWorkflowState(process.cwd());
                        const totalMissing = missingF.length + missingR.length;
                        if (totalMissing > 0) {
                            const bootstrapped =
                                bootstrapMissingWorkflowSnapshots(process.cwd(), missingF, 'feature') +
                                bootstrapMissingWorkflowSnapshots(process.cwd(), missingR, 'research');
                            if (bootstrapped > 0) {
                                console.log(`\n✓ Bootstrapped workflow state for ${bootstrapped} entit${bootstrapped === 1 ? 'y' : 'ies'} from folder layout.`);
                            } else {
                                // Bootstrap saw the missing entities but couldn't create snapshots.
                                // Surface so the user can run doctor manually.
                                console.log(`\n⚠️  ${totalMissing} entit${totalMissing === 1 ? 'y' : 'ies'} missing workflow state.`);
                                console.log(`   Run \`aigon doctor --fix\` to migrate.`);
                            }
                        }
                    }
                } catch (_) { /* non-fatal */ }

                if (versionChanged || hasFileChanges) {
                    console.log(`\n✅ Aigon updated to v${currentVersion || 'unknown'}.`);
                    showPortSummary();
                    if (hasFileChanges) {
                        if (noCommit) {
                            console.log(`\n📝 To commit these changes:`);
                            console.log(`   git add ${aigonPathsStr} 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                        } else {
                            try {
                                execSync(`git add ${aigonPathsStr} 2>/dev/null`, { encoding: 'utf8' });
                                execSync(`git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`, { encoding: 'utf8' });
                                console.log(`\n📦 Committed Aigon apply (v${currentVersion || 'latest'}).`);
                            } catch (e) {
                                console.log(`\n⚠️  Could not auto-commit: ${e.message}`);
                                console.log(`   git add ${aigonPathsStr} 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                            }
                        }
                    }
                } else {
                    console.log(`\n✅ Aigon is already up to date (v${currentVersion || 'unknown'}).`);
                }

            } catch (e) {
                console.error(`❌ Apply failed: ${e.message}`);
            }

            if (_isFirstTime) {
                printFirstTimeNextStepHint();
            }
    };
};
